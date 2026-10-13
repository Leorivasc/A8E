#include "LibraryRepository.h"

#include <errno.h>
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifdef _WIN32
#include <direct.h>
#define A8E_MAKE_DIRECTORY(path) _mkdir(path)
#else
#include <sys/stat.h>
#define A8E_MAKE_DIRECTORY(path) mkdir(path, 0777)
#endif

#include "LibraryPackage.h"
#include "LibraryImage.h"

#define A8E_REPOSITORY_MAX_PATH 1024u

static void A8E_LibraryRepository_SetError(
	char *pError,
	uint32_t lErrorSize,
	const char *pMessage)
{
	if(pError && lErrorSize > 0) snprintf(pError, lErrorSize, "%s", pMessage);
}

static const char *A8E_LibraryRepository_SkipSpace(
	const char *pText,
	const char *pEnd)
{
	while(pText < pEnd && (*pText == ' ' || *pText == '\t' ||
		*pText == '\r' || *pText == '\n')) pText++;
	return pText;
}

static const char *A8E_LibraryRepository_FindKey(
	const char *pBegin,
	const char *pEnd,
	const char *pKey)
{
	char sNeedle[64];
	int lLength;
	const char *p;

	lLength = snprintf(sNeedle, sizeof(sNeedle), "\"%s\"", pKey);
	if(lLength <= 0 || (size_t)lLength >= sizeof(sNeedle)) return NULL;
	for(p = pBegin; p + lLength < pEnd; p++)
	{
		const char *pValue;
		if(memcmp(p, sNeedle, (size_t)lLength) != 0) continue;
		pValue = A8E_LibraryRepository_SkipSpace(p + lLength, pEnd);
		if(pValue < pEnd && *pValue == ':')
			return A8E_LibraryRepository_SkipSpace(pValue + 1, pEnd);
	}
	return NULL;
}

static const char *A8E_LibraryRepository_Match(
	const char *pStart,
	const char *pEnd,
	char cOpen,
	char cClose)
{
	const char *p;
	uint32_t lDepth = 0;
	int bString = 0;
	int bEscape = 0;
	for(p = pStart; p < pEnd; p++)
	{
		if(bString)
		{
			if(bEscape) bEscape = 0;
			else if(*p == '\\') bEscape = 1;
			else if(*p == '"') bString = 0;
			continue;
		}
		if(*p == '"') bString = 1;
		else if(*p == cOpen) lDepth++;
		else if(*p == cClose && lDepth > 0u)
		{
			lDepth--;
			if(lDepth == 0u) return p;
		}
	}
	return NULL;
}

static int A8E_LibraryRepository_HexDigit(char cValue)
{
	if(cValue >= '0' && cValue <= '9') return cValue - '0';
	if(cValue >= 'a' && cValue <= 'f') return cValue - 'a' + 10;
	if(cValue >= 'A' && cValue <= 'F') return cValue - 'A' + 10;
	return -1;
}

static char *A8E_LibraryRepository_ReadString(
	const char *pValue,
	const char *pEnd)
{
	const char *p;
	char *pResult;
	uint32_t lCapacity;
	uint32_t lLength = 0;

	if(!pValue || !pEnd || pValue >= pEnd || *pValue != '"') return NULL;
	lCapacity = (uint32_t)(pEnd - pValue) + 1u;
	if(lCapacity == 0u) return NULL;
	pResult = (char *)malloc(lCapacity);
	if(!pResult) return NULL;
	for(p = pValue + 1; p < pEnd && *p != '"'; p++)
	{
		if(*p != '\\')
		{
			pResult[lLength++] = *p;
			continue;
		}
		if(++p >= pEnd) break;
		switch(*p)
		{
		case '"': case '\\': case '/': pResult[lLength++] = *p; break;
		case 'b': pResult[lLength++] = '\b'; break;
		case 'f': pResult[lLength++] = '\f'; break;
		case 'n': pResult[lLength++] = '\n'; break;
		case 'r': pResult[lLength++] = '\r'; break;
		case 't': pResult[lLength++] = '\t'; break;
		case 'u':
			/* Library names are retained as UTF-8 when emitted directly. For a
			 * JSON \u escape, keep a safe placeholder rather than copying a
			 * malformed multibyte sequence into the native UI. */
			if(p + 4 >= pEnd || A8E_LibraryRepository_HexDigit(p[1]) < 0 ||
				A8E_LibraryRepository_HexDigit(p[2]) < 0 ||
				A8E_LibraryRepository_HexDigit(p[3]) < 0 ||
				A8E_LibraryRepository_HexDigit(p[4]) < 0)
			{
				free(pResult);
				return NULL;
			}
			p += 4;
			pResult[lLength++] = '?';
			break;
		default: free(pResult); return NULL;
		}
	}
	if(p >= pEnd || *p != '"')
	{
		free(pResult);
		return NULL;
	}
	pResult[lLength] = '\0';
	return pResult;
}

static int A8E_LibraryRepository_ReadInteger(
	const char *pValue,
	const char *pEnd,
	int32_t *pResult)
{
	int bNegative = 0;
	int64_t lValue = 0;
	const char *p = pValue;
	if(!p || p >= pEnd) return 0;
	if(*p == '-') { bNegative = 1; p++; }
	if(p >= pEnd || *p < '0' || *p > '9') return 0;
	while(p < pEnd && *p >= '0' && *p <= '9')
	{
		lValue = lValue * 10 + (*p - '0');
		if(lValue > 0x7fffffffu) return 0;
		p++;
	}
	if(pResult) *pResult = (int32_t)(bNegative ? -lValue : lValue);
	return 1;
}

static int A8E_LibraryRepository_ReadBoolean(
	const char *pValue,
	const char *pEnd)
{
	return pValue && (size_t)(pEnd - pValue) >= 4u &&
		memcmp(pValue, "true", 4) == 0;
}

static const char *A8E_LibraryRepository_ValueEnd(
	const char *pValue,
	const char *pEnd)
{
	const char *p;
	if(!pValue || pValue >= pEnd) return NULL;
	if(*pValue == '"')
	{
		int bEscape = 0;
		for(p = pValue + 1; p < pEnd; p++)
		{
			if(bEscape) bEscape = 0;
			else if(*p == '\\') bEscape = 1;
			else if(*p == '"') return p + 1;
		}
		return NULL;
	}
	for(p = pValue; p < pEnd && *p != ',' && *p != '}'; p++);
	while(p > pValue && (p[-1] == ' ' || p[-1] == '\t' ||
		p[-1] == '\r' || p[-1] == '\n')) p--;
	return p;
}

static int A8E_LibraryRepository_ReplaceSpan(
	uint8_t **ppBytes,
	uint32_t *pSize,
	uint32_t lStart,
	uint32_t lEnd,
	const char *pReplacement,
	uint32_t lReplacementSize)
{
	uint8_t *pResult;
	uint32_t lOldSize;
	uint32_t lNewSize;
	if(!ppBytes || !pSize || !pReplacement || lStart > lEnd || lEnd > *pSize)
		return 0;
	lOldSize = lEnd - lStart;
	if(*pSize - lOldSize > 0xffffffffu - lReplacementSize) return 0;
	lNewSize = *pSize - lOldSize + lReplacementSize;
	pResult = (uint8_t *)malloc(lNewSize ? lNewSize : 1u);
	if(!pResult) return 0;
	if(lStart > 0) memcpy(pResult, *ppBytes, lStart);
	if(lReplacementSize > 0) memcpy(pResult + lStart, pReplacement, lReplacementSize);
	if(lEnd < *pSize) memcpy(
		pResult + lStart + lReplacementSize,
		*ppBytes + lEnd, *pSize - lEnd);
	free(*ppBytes);
	*ppBytes = pResult;
	*pSize = lNewSize;
	return 1;
}

static int A8E_LibraryRepository_ReplaceObjectField(
	uint8_t **ppObject,
	uint32_t *pObjectSize,
	const char *pKey,
	const char *pReplacement)
{
	const char *pBegin = (const char *)*ppObject;
	const char *pEnd = pBegin + *pObjectSize;
	const char *pValue = A8E_LibraryRepository_FindKey(pBegin, pEnd, pKey);
	const char *pValueEnd;
	if(!pValue) return 1;
	pValueEnd = A8E_LibraryRepository_ValueEnd(pValue, pEnd);
	if(!pValueEnd) return 0;
	return A8E_LibraryRepository_ReplaceSpan(
		ppObject, pObjectSize, (uint32_t)(pValue - pBegin),
		(uint32_t)(pValueEnd - pBegin), pReplacement,
		(uint32_t)strlen(pReplacement));
}

static int A8E_LibraryRepository_ReplaceManifestField(
	A8E_LibraryRepository_t *pRepository,
	const char *pKey,
	const char *pReplacement)
{
	const char *pBegin = (const char *)pRepository->pManifest;
	const char *pEnd = pBegin + pRepository->lManifestSize;
	const char *pValue = A8E_LibraryRepository_FindKey(pBegin, pEnd, pKey);
	const char *pValueEnd;
	if(!pValue) return 0;
	pValueEnd = A8E_LibraryRepository_ValueEnd(pValue, pEnd);
	if(!pValueEnd) return 0;
	return A8E_LibraryRepository_ReplaceSpan(
		&pRepository->pManifest, &pRepository->lManifestSize,
		(uint32_t)(pValue - pBegin), (uint32_t)(pValueEnd - pBegin),
		pReplacement, (uint32_t)strlen(pReplacement));
}

static int A8E_LibraryRepository_ReplaceRecordFields(
	A8E_LibraryRepository_t *pRepository,
	A8E_LibraryRepositoryRecord_t *pRecord,
	const char *pType,
	const char *pPath,
	uint32_t lSize,
	const char *pHash)
{
	uint8_t *pObject;
	uint32_t lObjectSize;
	char sQuotedPath[1024];
	char sQuotedHash[80];
	char sQuotedType[16];
	char sSize[32];
	char sQuotedModifiedAt[48];
	char sTime[32];
	time_t lNow;
	struct tm *pUtc;
	const char *pBegin = (const char *)pRepository->pManifest;
	if(pRecord->lObjectEnd < pRecord->lObjectStart ||
		pRecord->lObjectEnd >= pRepository->lManifestSize) return 0;
	lObjectSize = pRecord->lObjectEnd - pRecord->lObjectStart + 1u;
	pObject = (uint8_t *)malloc(lObjectSize);
	if(!pObject) return 0;
	memcpy(pObject, pBegin + pRecord->lObjectStart, lObjectSize);
	snprintf(sQuotedPath, sizeof(sQuotedPath), "\"%s\"", pPath);
	snprintf(sQuotedHash, sizeof(sQuotedHash), "\"%s\"", pHash);
	snprintf(sQuotedType, sizeof(sQuotedType), "\"%s\"", pType ? pType : pRecord->pType);
	snprintf(sSize, sizeof(sSize), "%u", lSize);
	if(!A8E_LibraryRepository_ReplaceObjectField(
		&pObject, &lObjectSize, "type", sQuotedType) ||
		!A8E_LibraryRepository_ReplaceObjectField(
		&pObject, &lObjectSize, "path", sQuotedPath) ||
		!A8E_LibraryRepository_ReplaceObjectField(
			&pObject, &lObjectSize, "sha256", sQuotedHash) ||
		!A8E_LibraryRepository_ReplaceObjectField(
			&pObject, &lObjectSize, "size", sSize))
	{
		free(pObject);
		return 0;
	}
	lNow = time(NULL);
	pUtc = gmtime(&lNow);
	if(pUtc && strftime(sTime, sizeof(sTime), "%Y-%m-%dT%H:%M:%SZ", pUtc) > 0)
	{
		snprintf(sQuotedModifiedAt, sizeof(sQuotedModifiedAt), "\"%s\"", sTime);
		if(!A8E_LibraryRepository_ReplaceObjectField(
			&pObject, &lObjectSize, "modifiedAt", sQuotedModifiedAt))
		{
			free(pObject);
			return 0;
		}
	}
	if(!A8E_LibraryRepository_ReplaceSpan(
		&pRepository->pManifest, &pRepository->lManifestSize,
		pRecord->lObjectStart, pRecord->lObjectEnd + 1u,
		(const char *)pObject, lObjectSize))
	{
		free(pObject);
		return 0;
	}
	free(pObject);
	return 1;
}

static void A8E_LibraryRepository_FreeRecordFields(
	A8E_LibraryRepositoryRecord_t *pRecord)
{
	if(!pRecord) return;
	free(pRecord->pId);
	free(pRecord->pName);
	free(pRecord->pType);
	free(pRecord->pPath);
	free(pRecord->pFolderId);
}

static void A8E_LibraryRepository_FreeRecords(
	A8E_LibraryRepositoryRecord_t *pRecords,
	uint16_t sRecordCount)
{
	uint16_t i;
	if(!pRecords) return;
	for(i = 0; i < sRecordCount; i++)
		A8E_LibraryRepository_FreeRecordFields(&pRecords[i]);
	free(pRecords);
}

static int A8E_LibraryRepository_ParseManifest(
	A8E_LibraryRepository_t *pRepository,
	char *pError,
	uint32_t lErrorSize)
{
	const char *pBegin = (const char *)pRepository->pManifest;
	const char *pEnd = pBegin + pRepository->lManifestSize;
	const char *pArray = A8E_LibraryRepository_FindKey(pBegin, pEnd, "library");
	const char *pArrayEnd;
	const char *p;

	if(!pArray || *pArray != '[' ||
		!(pArrayEnd = A8E_LibraryRepository_Match(pArray, pEnd, '[', ']')))
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid library records");
		return 0;
	}
	for(p = pArray + 1; p < pArrayEnd; p++)
	{
		const char *pObject = p;
		const char *pObjectEnd;
		A8E_LibraryRepositoryRecord_t tRecord;
		int32_t lValue;
		memset(&tRecord, 0, sizeof(tRecord));
		if(*p != '{') continue;
		if(!(pObjectEnd = A8E_LibraryRepository_Match(pObject, pArrayEnd + 1, '{', '}')))
		{
			A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid library record object");
			return 0;
		}
		tRecord.pId = A8E_LibraryRepository_ReadString(
			A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "id"), pObjectEnd + 1);
		tRecord.pName = A8E_LibraryRepository_ReadString(
			A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "name"), pObjectEnd + 1);
		tRecord.pType = A8E_LibraryRepository_ReadString(
			A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "type"), pObjectEnd + 1);
		tRecord.pPath = A8E_LibraryRepository_ReadString(
			A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "path"), pObjectEnd + 1);
		if(!tRecord.pId || !tRecord.pName || !tRecord.pType || !tRecord.pPath ||
			(strcmp(tRecord.pType, "atr") != 0 && strcmp(tRecord.pType, "xex") != 0) ||
			strncmp(tRecord.pPath, "blobs/", 6) != 0 ||
			!A8E_LibraryRepository_ReadInteger(
				A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "size"),
				pObjectEnd + 1, &lValue) || lValue < 0)
		{
			A8E_LibraryRepository_FreeRecordFields(&tRecord);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid library record fields");
			return 0;
		}
		tRecord.lSize = (uint32_t)lValue;
		tRecord.lMountedSlot = -1;
		tRecord.lObjectStart = (uint32_t)(pObject - pBegin);
		tRecord.lObjectEnd = (uint32_t)(pObjectEnd - pBegin);
		if(A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "mountedSlot"))
		{
			if(!A8E_LibraryRepository_ReadInteger(
				A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "mountedSlot"),
				pObjectEnd + 1, &tRecord.lMountedSlot) ||
				tRecord.lMountedSlot < -1 || tRecord.lMountedSlot > 7)
			{
				A8E_LibraryRepository_FreeRecordFields(&tRecord);
				A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid mounted slot");
				return 0;
			}
		}
		{
			char *pFolder = A8E_LibraryRepository_ReadString(
				A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "folderId"),
				pObjectEnd + 1);
			tRecord.pFolderId = pFolder;
		}
		if(pRepository->sRecordCount == 0xffffu)
		{
			A8E_LibraryRepository_FreeRecordFields(&tRecord);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "too many library records");
			return 0;
		}
		{
			A8E_LibraryRepositoryRecord_t *pRecords = (A8E_LibraryRepositoryRecord_t *)realloc(
				pRepository->pRecords,
				(size_t)(pRepository->sRecordCount + 1u) * sizeof(*pRecords));
			if(!pRecords)
			{
				A8E_LibraryRepository_FreeRecordFields(&tRecord);
				A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
				return 0;
			}
			pRepository->pRecords = pRecords;
			pRepository->pRecords[pRepository->sRecordCount++] = tRecord;
		}
		p = pObjectEnd;
	}
	return 1;
}

static void A8E_LibraryRepository_ParseWorkspace(
	A8E_LibraryRepository_t *pRepository)
{
	const char *pBegin = (const char *)pRepository->pManifest;
	const char *pEnd = pBegin + pRepository->lManifestSize;
	const char *pWorkspace = A8E_LibraryRepository_FindKey(pBegin, pEnd, "workspace");
	const char *pWorkspaceEnd;
	uint32_t i;
	if(!pWorkspace || *pWorkspace != '{' ||
		!(pWorkspaceEnd = A8E_LibraryRepository_Match(pWorkspace, pEnd, '{', '}'))) return;
	for(i = 0; i < 8u; i++)
	{
		char sDevice[4];
		const char *pDevices = A8E_LibraryRepository_FindKey(
			pWorkspace, pWorkspaceEnd + 1, "devices");
		const char *pDevicesEnd = pDevices && *pDevices == '{'
			? A8E_LibraryRepository_Match(pDevices, pWorkspaceEnd + 1, '{', '}') : NULL;
		const char *pWriteProtected = A8E_LibraryRepository_FindKey(
			pWorkspace, pWorkspaceEnd + 1, "writeProtected");
		const char *pWriteEnd = pWriteProtected && *pWriteProtected == '{'
			? A8E_LibraryRepository_Match(pWriteProtected, pWorkspaceEnd + 1, '{', '}') : NULL;
		char *pEntryId = NULL;
		const char *pValue;
		snprintf(sDevice, sizeof(sDevice), "D%u", i + 1u);
		if(pDevicesEnd && (pValue = A8E_LibraryRepository_FindKey(pDevices, pDevicesEnd + 1, sDevice)))
			pEntryId = A8E_LibraryRepository_ReadString(pValue, pDevicesEnd + 1);
		if(pEntryId)
		{
			strncpy(pRepository->acDeviceEntryId[i], pEntryId,
				sizeof(pRepository->acDeviceEntryId[i]) - 1u);
			pRepository->acDeviceEntryId[i][sizeof(pRepository->acDeviceEntryId[i]) - 1u] = '\0';
			free(pEntryId);
		}
		if(pWriteEnd && (pValue = A8E_LibraryRepository_FindKey(
			pWriteProtected, pWriteEnd + 1, sDevice)))
			pRepository->abDeviceWriteProtected[i] = (uint8_t)
				A8E_LibraryRepository_ReadBoolean(pValue, pWriteEnd + 1);
	}
}

static int A8E_LibraryRepository_MakeDirectory(
	const char *pPath,
	char *pError,
	uint32_t lErrorSize)
{
	if(A8E_MAKE_DIRECTORY(pPath) != 0 && errno != EEXIST)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot create library directory");
		return 0;
	}
	return 1;
}

static int A8E_LibraryRepository_JoinPath(
	char *pPath,
	uint32_t lPathSize,
	const char *pRoot,
	const char *pName)
{
	int lLength;
	if(!pPath || !pRoot || !pName) return 0;
	lLength = snprintf(pPath, lPathSize, "%s/%s", pRoot, pName);
	return lLength >= 0 && (uint32_t)lLength < lPathSize;
}

static int A8E_LibraryRepository_ReadFile(
	const char *pPath,
	uint8_t **ppBytes,
	uint32_t *pSize,
	char *pError,
	uint32_t lErrorSize)
{
	FILE *pFile;
	long lFileSize;
	uint8_t *pBytes = NULL;
	uint32_t lRead;

	if(ppBytes) *ppBytes = NULL;
	if(pSize) *pSize = 0;
	pFile = fopen(pPath, "rb");
	if(!pFile)
	{
		snprintf(pError, lErrorSize, "cannot open library file: %s", pPath);
		return 0;
	}
	if(fseek(pFile, 0, SEEK_END) != 0 || (lFileSize = ftell(pFile)) < 0 ||
		(unsigned long)lFileSize > 0xfffffffful || fseek(pFile, 0, SEEK_SET) != 0)
	{
		fclose(pFile);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid library file size");
		return 0;
	}
	if(lFileSize > 0)
	{
		pBytes = (uint8_t *)malloc((size_t)lFileSize);
		if(!pBytes)
		{
			fclose(pFile);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
			return 0;
		}
		lRead = (uint32_t)fread(pBytes, 1, (size_t)lFileSize, pFile);
		if(lRead != (uint32_t)lFileSize)
		{
			free(pBytes);
			fclose(pFile);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot read library file");
			return 0;
		}
	}
	fclose(pFile);
	if(ppBytes) *ppBytes = pBytes;
	if(pSize) *pSize = (uint32_t)lFileSize;
	return 1;
}

static int A8E_LibraryRepository_WriteFile(
	const char *pPath,
	const uint8_t *pBytes,
	uint32_t lSize,
	char *pError,
	uint32_t lErrorSize)
{
	FILE *pFile = fopen(pPath, "wb");
	if(!pFile)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot create library file");
		return 0;
	}
	if(lSize > 0 && fwrite(pBytes, 1, lSize, pFile) != lSize)
	{
		fclose(pFile);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot write library file");
		return 0;
	}
	if(fclose(pFile) != 0)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot close library file");
		return 0;
	}
	return 1;
}

static int A8E_LibraryRepository_SaveManifest(
	const A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	char *pError,
	uint32_t lErrorSize)
{
	char sPath[A8E_REPOSITORY_MAX_PATH];
	char sTempPath[A8E_REPOSITORY_MAX_PATH];
	if(!pRepository || !pRootPath || !pRepository->pManifest)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "repository is incomplete");
		return 0;
	}
	if(!A8E_LibraryRepository_MakeDirectory(pRootPath, pError, lErrorSize) ||
		!A8E_LibraryRepository_JoinPath(
			sTempPath, sizeof(sTempPath), pRootPath, "library.json.tmp") ||
		!A8E_LibraryRepository_WriteFile(
			sTempPath, pRepository->pManifest, pRepository->lManifestSize,
			pError, lErrorSize) ||
		!A8E_LibraryRepository_JoinPath(
			sPath, sizeof(sPath), pRootPath, "library.json"))
	{
		return 0;
	}
	remove(sPath);
	if(rename(sTempPath, sPath) != 0)
	{
		remove(sTempPath);
		A8E_LibraryRepository_SetError(
			pError, lErrorSize, "cannot install library manifest");
		return 0;
	}
	return 1;
}

static int A8E_LibraryRepository_AddPath(
	char ***ppPaths,
	uint16_t *pPathCount,
	const char *pPath,
	uint32_t lPathLength)
{
	char **pPaths;
	char *pCopy;
	uint16_t i;
	if(lPathLength == 0 || lPathLength >= A8E_REPOSITORY_MAX_PATH ||
		!ppPaths || !pPathCount || *pPathCount == 0xffffu) return 0;
	for(i = 0; i < *pPathCount; i++)
	{
		if(strlen((*ppPaths)[i]) == lPathLength &&
			memcmp((*ppPaths)[i], pPath, lPathLength) == 0) return 1;
	}
	pPaths = (char **)realloc(*ppPaths, (size_t)(*pPathCount + 1u) * sizeof(*pPaths));
	if(!pPaths) return 0;
	pCopy = (char *)malloc(lPathLength + 1u);
	if(!pCopy)
	{
		*ppPaths = pPaths;
		return 0;
	}
	memcpy(pCopy, pPath, lPathLength);
	pCopy[lPathLength] = '\0';
	pPaths[*pPathCount] = pCopy;
	*ppPaths = pPaths;
	(*pPathCount)++;
	return 1;
}

static void A8E_LibraryRepository_FreePaths(char **pPaths, uint16_t sPathCount)
{
	uint16_t i;
	for(i = 0; i < sPathCount; i++) free(pPaths[i]);
	free(pPaths);
}

static int A8E_LibraryRepository_FindBlobPaths(
	const uint8_t *pManifest,
	uint32_t lManifestSize,
	char ***ppPaths,
	uint16_t *pPathCount)
{
	const char *p = (const char *)pManifest;
	const char *pEnd = p + lManifestSize;
	static const char sPrefix[] = "\"path\":\"";
	char **pPaths = NULL;
	uint16_t sPathCount = 0;

	while(p < pEnd)
	{
		const char *pStart = p;
		const char *pValue;
		const char *pStop;
		while(pStart < pEnd &&
			((size_t)(pEnd - pStart) < sizeof(sPrefix) - 1 ||
			memcmp(pStart, sPrefix, sizeof(sPrefix) - 1) != 0)) pStart++;
		if(pStart >= pEnd) break;
		pValue = pStart + sizeof(sPrefix) - 1;
		pStop = (const char *)memchr(pValue, '"', (size_t)(pEnd - pValue));
		if(!pStop || (size_t)(pStop - pValue) < 7 ||
			memcmp(pValue, "blobs/", 6) != 0)
		{
			A8E_LibraryRepository_FreePaths(pPaths, sPathCount);
			return 0;
		}
		if(!A8E_LibraryRepository_AddPath(
			&pPaths, &sPathCount, pValue, (uint32_t)(pStop - pValue)))
		{
			A8E_LibraryRepository_FreePaths(pPaths, sPathCount);
			return 0;
		}
		p = pStop + 1;
	}
	*ppPaths = pPaths;
	*pPathCount = sPathCount;
	return 1;
}

void A8E_LibraryRepository_Init(A8E_LibraryRepository_t *pRepository)
{
	if(pRepository) memset(pRepository, 0, sizeof(*pRepository));
}

void A8E_LibraryRepository_Free(A8E_LibraryRepository_t *pRepository)
{
	if(!pRepository) return;
	free(pRepository->pManifest);
	A8E_LibraryArchive_FreeEntries(pRepository->pPayloads, pRepository->sPayloadCount);
	A8E_LibraryRepository_FreeRecords(pRepository->pRecords, pRepository->sRecordCount);
	memset(pRepository, 0, sizeof(*pRepository));
}

int A8E_LibraryRepository_LoadDirectory(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tStaged;
	char sPath[A8E_REPOSITORY_MAX_PATH];
	char **pPaths = NULL;
	uint16_t sPathCount = 0;
	uint16_t i;

	if(!pRepository || !pRootPath)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "repository or path is missing");
		return 0;
	}
	A8E_LibraryRepository_Init(&tStaged);
	if(!A8E_LibraryRepository_JoinPath(sPath, sizeof(sPath), pRootPath, "library.json") ||
		!A8E_LibraryRepository_ReadFile(
			sPath, &tStaged.pManifest, &tStaged.lManifestSize, pError, lErrorSize) ||
		!A8E_LibraryPackage_ValidateManifest(
			tStaged.pManifest, tStaged.lManifestSize, &tStaged.lLibraryVersion,
			pError, lErrorSize) ||
		!A8E_LibraryRepository_ParseManifest(&tStaged, pError, lErrorSize) ||
		!A8E_LibraryRepository_FindBlobPaths(
			tStaged.pManifest, tStaged.lManifestSize, &pPaths, &sPathCount))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid library directory");
		return 0;
	}
	A8E_LibraryRepository_ParseWorkspace(&tStaged);
	if(sPathCount > 0)
	{
		tStaged.pPayloads = (A8E_LibraryArchiveEntry_t *)calloc(
			sPathCount, sizeof(*tStaged.pPayloads));
		if(!tStaged.pPayloads)
		{
			A8E_LibraryRepository_FreePaths(pPaths, sPathCount);
			A8E_LibraryRepository_Free(&tStaged);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
			return 0;
		}
	}
	for(i = 0; i < sPathCount; i++)
	{
		if(!A8E_LibraryRepository_JoinPath(sPath, sizeof(sPath), pRootPath, pPaths[i]) ||
			!A8E_LibraryRepository_ReadFile(
				sPath, &tStaged.pPayloads[i].pBytes, &tStaged.pPayloads[i].lSize,
				pError, lErrorSize))
		{
			A8E_LibraryRepository_FreePaths(pPaths, sPathCount);
			A8E_LibraryRepository_Free(&tStaged);
			return 0;
		}
		tStaged.sPayloadCount = (uint16_t)(i + 1u);
		tStaged.pPayloads[i].pName = (char *)malloc(strlen(pPaths[i]) + 1u);
		if(!tStaged.pPayloads[i].pName)
		{
			A8E_LibraryRepository_FreePaths(pPaths, sPathCount);
			A8E_LibraryRepository_Free(&tStaged);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
			return 0;
		}
		strcpy(tStaged.pPayloads[i].pName, pPaths[i]);
	}
	A8E_LibraryRepository_FreePaths(pPaths, sPathCount);

	/* Reuse the package validator for SHA-256, size, path, and duplicate checks. */
	{
		A8E_LibraryArchiveInput_t *pInputs = NULL;
		uint8_t *pArchive = NULL;
		uint32_t lArchiveSize = 0;
		if(tStaged.sPayloadCount > 0)
		{
			pInputs = (A8E_LibraryArchiveInput_t *)calloc(
				tStaged.sPayloadCount, sizeof(*pInputs));
			if(!pInputs)
			{
				A8E_LibraryRepository_Free(&tStaged);
				A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
				return 0;
			}
		}
		for(i = 0; i < tStaged.sPayloadCount; i++)
		{
			pInputs[i].pName = tStaged.pPayloads[i].pName;
			pInputs[i].pBytes = tStaged.pPayloads[i].pBytes;
			pInputs[i].lSize = tStaged.pPayloads[i].lSize;
		}
		if(!A8E_LibraryPackage_Write(
			tStaged.pManifest, tStaged.lManifestSize, pInputs,
			tStaged.sPayloadCount, &pArchive, &lArchiveSize, pError, lErrorSize))
		{
			free(pInputs);
			A8E_LibraryRepository_Free(&tStaged);
			return 0;
		}
		free(pInputs);
		free(pArchive);
	}
	A8E_LibraryRepository_Free(pRepository);
	*pRepository = tStaged;
	return 1;
}

const A8E_LibraryRepositoryRecord_t *A8E_LibraryRepository_GetRecord(
	const A8E_LibraryRepository_t *pRepository,
	uint16_t sIndex)
{
	if(!pRepository || sIndex >= pRepository->sRecordCount) return NULL;
	return &pRepository->pRecords[sIndex];
}

const uint8_t *A8E_LibraryRepository_GetPayload(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPath,
	uint32_t *pSize)
{
	uint16_t i;
	if(pSize) *pSize = 0u;
	if(!pRepository || !pPath) return NULL;
	for(i = 0; i < pRepository->sPayloadCount; i++)
	{
		if(pRepository->pPayloads[i].pName &&
			strcmp(pRepository->pPayloads[i].pName, pPath) == 0)
		{
			if(pSize) *pSize = pRepository->pPayloads[i].lSize;
			return pRepository->pPayloads[i].pBytes;
		}
	}
	return NULL;
}

const char *A8E_LibraryRepository_GetDeviceEntryId(
	const A8E_LibraryRepository_t *pRepository,
	uint32_t lDrive)
{
	if(!pRepository || lDrive >= 8u || pRepository->acDeviceEntryId[lDrive][0] == '\0')
		return NULL;
	return pRepository->acDeviceEntryId[lDrive];
}

uint8_t A8E_LibraryRepository_IsDeviceWriteProtected(
	const A8E_LibraryRepository_t *pRepository,
	uint32_t lDrive)
{
	if(!pRepository || lDrive >= 8u) return 0u;
	return pRepository->abDeviceWriteProtected[lDrive];
}

static char *A8E_LibraryRepository_DuplicateString(const char *pText)
{
	char *pCopy;
	if(!pText) return NULL;
	pCopy = (char *)malloc(strlen(pText) + 1u);
	if(pCopy) strcpy(pCopy, pText);
	return pCopy;
}

static int A8E_LibraryRepository_AddPayload(
	A8E_LibraryRepository_t *pRepository,
	const char *pPath,
	const uint8_t *pBytes,
	uint32_t lSize)
{
	A8E_LibraryArchiveEntry_t *pEntries;
	uint8_t *pCopy = NULL;
	uint16_t i;
	if(!pRepository || !pPath || (lSize > 0u && !pBytes)) return 0;
	if(lSize > 0u)
	{
		pCopy = (uint8_t *)malloc(lSize);
		if(!pCopy) return 0;
		memcpy(pCopy, pBytes, lSize);
	}
	for(i = 0; i < pRepository->sPayloadCount; i++)
	{
		if(strcmp(pRepository->pPayloads[i].pName, pPath) == 0)
		{
			free(pRepository->pPayloads[i].pBytes);
			pRepository->pPayloads[i].pBytes = pCopy;
			pRepository->pPayloads[i].lSize = lSize;
			return 1;
		}
	}
	if(pRepository->sPayloadCount == 0xffffu)
	{
		free(pCopy);
		return 0;
	}
	pEntries = (A8E_LibraryArchiveEntry_t *)realloc(
		pRepository->pPayloads,
		(size_t)(pRepository->sPayloadCount + 1u) * sizeof(*pEntries));
	if(!pEntries)
	{
		free(pCopy);
		return 0;
	}
	pRepository->pPayloads = pEntries;
	pEntries[pRepository->sPayloadCount].pName =
		A8E_LibraryRepository_DuplicateString(pPath);
	if(!pEntries[pRepository->sPayloadCount].pName)
	{
		free(pCopy);
		return 0;
	}
	pEntries[pRepository->sPayloadCount].pBytes = pCopy;
	pEntries[pRepository->sPayloadCount].lSize = lSize;
	pRepository->sPayloadCount++;
	return 1;
}

static void A8E_LibraryRepository_RemovePayload(
	A8E_LibraryRepository_t *pRepository,
	const char *pPath)
{
	uint16_t i;
	if(!pRepository || !pPath) return;
	for(i = 0; i < pRepository->sPayloadCount; i++)
	{
		if(strcmp(pRepository->pPayloads[i].pName, pPath) != 0) continue;
		free(pRepository->pPayloads[i].pName);
		free(pRepository->pPayloads[i].pBytes);
		if(i + 1u < pRepository->sPayloadCount)
			memmove(&pRepository->pPayloads[i], &pRepository->pPayloads[i + 1u],
				(size_t)(pRepository->sPayloadCount - i - 1u) * sizeof(*pRepository->pPayloads));
		pRepository->sPayloadCount--;
		return;
	}
}

static int A8E_LibraryRepository_IsPayloadReferenced(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPath)
{
	uint16_t i;
	for(i = 0; i < pRepository->sRecordCount; i++)
		if(strcmp(pRepository->pRecords[i].pPath, pPath) == 0) return 1;
	return 0;
}

static A8E_LibraryRepositoryRecord_t *A8E_LibraryRepository_FindRecord(
	A8E_LibraryRepository_t *pRepository,
	const char *pEntryId,
	uint16_t *pIndex)
{
	uint16_t i;
	if(!pRepository || !pEntryId) return NULL;
	for(i = 0; i < pRepository->sRecordCount; i++)
		if(strcmp(pRepository->pRecords[i].pId, pEntryId) == 0)
		{
			if(pIndex) *pIndex = i;
			return &pRepository->pRecords[i];
		}
	return NULL;
}

static int A8E_LibraryRepository_IncrementVersion(
	A8E_LibraryRepository_t *pRepository)
{
	char sVersion[32];
	if(pRepository->lLibraryVersion == 0xffffffffu) return 0;
	pRepository->lLibraryVersion++;
	snprintf(sVersion, sizeof(sVersion), "%u", pRepository->lLibraryVersion);
	return A8E_LibraryRepository_ReplaceManifestField(
		pRepository, "libraryVersion", sVersion);
}

static int A8E_LibraryRepository_AppendJsonString(
	char *pText,
	uint32_t lCapacity,
	uint32_t *pLength,
	const char *pValue)
{
	const unsigned char *p;
	if(!pText || !pLength || !pValue || *pLength >= lCapacity) return 0;
	if(*pLength + 1u >= lCapacity) return 0;
	pText[(*pLength)++] = '"';
	for(p = (const unsigned char *)pValue; *p; p++)
	{
		const char *pEscape = NULL;
		char cEscape = 0;
		switch(*p)
		{
		case '"': pEscape = "\\\""; break;
		case '\\': pEscape = "\\\\"; break;
		case '\b': pEscape = "\\b"; break;
		case '\f': pEscape = "\\f"; break;
		case '\n': pEscape = "\\n"; break;
		case '\r': pEscape = "\\r"; break;
		case '\t': pEscape = "\\t"; break;
		default:
			if(*p < 0x20u) cEscape = '?';
			break;
		}
		if(pEscape)
		{
			uint32_t lEscape = (uint32_t)strlen(pEscape);
			if(*pLength + lEscape >= lCapacity) return 0;
			memcpy(pText + *pLength, pEscape, lEscape);
			*pLength += lEscape;
		}
		else
		{
			if(*pLength + 1u >= lCapacity) return 0;
			pText[(*pLength)++] = cEscape ? cEscape : (char)*p;
		}
	}
	if(*pLength + 1u >= lCapacity) return 0;
	pText[(*pLength)++] = '"';
	pText[*pLength] = '\0';
	return 1;
}

static int A8E_LibraryRepository_AppendJsonLiteral(
	char *pText,
	uint32_t lCapacity,
	uint32_t *pLength,
	const char *pValue)
{
	uint32_t lValueSize;
	if(!pText || !pLength || !pValue) return 0;
	lValueSize = (uint32_t)strlen(pValue);
	if(*pLength >= lCapacity || lValueSize >= lCapacity - *pLength) return 0;
	memcpy(pText + *pLength, pValue, lValueSize);
	*pLength += lValueSize;
	pText[*pLength] = '\0';
	return 1;
}

static int A8E_LibraryRepository_BuildWorkspaceJson(
	const char *apEntryIds[8],
	const uint8_t abWriteProtected[8],
	char **ppJson,
	uint32_t *pJsonSize)
{
	char *pJson;
	uint32_t lLength = 0;
	uint32_t lDrive;
	const uint32_t lCapacity = 16384u;
	if(!ppJson || !pJsonSize) return 0;
	*ppJson = NULL;
	*pJsonSize = 0;
	pJson = (char *)malloc(lCapacity);
	if(!pJson) return 0;
	pJson[0] = '\0';
	pJson[lLength++] = '{';
	memcpy(pJson + lLength, "\"devices\":{", 11u);
	lLength += 11u;
	for(lDrive = 0; lDrive < 8u; lDrive++)
	{
		char sDevice[4];
		snprintf(sDevice, sizeof(sDevice), "D%u", lDrive + 1u);
		if(!apEntryIds || !apEntryIds[lDrive] || !apEntryIds[lDrive][0]) continue;
		if(lLength + 1u >= lCapacity) { free(pJson); return 0; }
		if(lLength > 12u && pJson[lLength - 1u] != '{') pJson[lLength++] = ',';
		if(!A8E_LibraryRepository_AppendJsonString(
			pJson, lCapacity, &lLength, sDevice) ||
			lLength + 1u >= lCapacity)
		{
			free(pJson);
			return 0;
		}
		pJson[lLength++] = ':';
		if(!A8E_LibraryRepository_AppendJsonString(
			pJson, lCapacity, &lLength, apEntryIds[lDrive]))
		{
			free(pJson);
			return 0;
		}
	}
	if(lLength + 20u >= lCapacity) { free(pJson); return 0; }
	memcpy(pJson + lLength, "},\"writeProtected\":{", 20u);
	lLength += 20u;
	for(lDrive = 0; lDrive < 8u; lDrive++)
	{
		char sDevice[4];
		snprintf(sDevice, sizeof(sDevice), "D%u", lDrive + 1u);
		if(!apEntryIds || !apEntryIds[lDrive] || !apEntryIds[lDrive][0]) continue;
		if(lLength + 1u >= lCapacity) { free(pJson); return 0; }
		if(pJson[lLength - 1u] != '{') pJson[lLength++] = ',';
		if(!A8E_LibraryRepository_AppendJsonString(
			pJson, lCapacity, &lLength, sDevice) || lLength + 7u >= lCapacity)
		{
			free(pJson);
			return 0;
		}
		pJson[lLength++] = ':';
		if(abWriteProtected && abWriteProtected[lDrive])
		{
			memcpy(pJson + lLength, "true", 4u);
			lLength += 4u;
		}
		else
		{
			memcpy(pJson + lLength, "false", 5u);
			lLength += 5u;
		}
	}
	if(lLength + 3u >= lCapacity) { free(pJson); return 0; }
	memcpy(pJson + lLength, "}}", 2u);
	lLength += 2u;
	pJson[lLength] = '\0';
	*ppJson = pJson;
	*pJsonSize = lLength;
	return 1;
}

static int A8E_LibraryRepository_ReplaceWorkspace(
	A8E_LibraryRepository_t *pRepository,
	const char *pWorkspaceJson,
	uint32_t lWorkspaceJsonSize)
{
	const char *pBegin;
	const char *pEnd;
	const char *pValue;
	const char *pValueEnd;
	if(!pRepository || !pWorkspaceJson) return 0;
	pBegin = (const char *)pRepository->pManifest;
	pEnd = pBegin + pRepository->lManifestSize;
	pValue = A8E_LibraryRepository_FindKey(pBegin, pEnd, "workspace");
	if(pValue && *pValue == '{')
	{
		const char *pObjectEnd = A8E_LibraryRepository_Match(pValue, pEnd, '{', '}');
		if(!pObjectEnd) return 0;
		return A8E_LibraryRepository_ReplaceSpan(
			&pRepository->pManifest, &pRepository->lManifestSize,
			(uint32_t)(pValue - pBegin), (uint32_t)(pObjectEnd - pBegin + 1u),
			pWorkspaceJson, lWorkspaceJsonSize);
	}
	/* Older valid packages may omit workspace entirely. Add it before the
	 * top-level closing brace while retaining their existing JSON. */
	pValueEnd = pEnd;
	while(pValueEnd > pBegin && isspace((unsigned char)pValueEnd[-1])) pValueEnd--;
	if(pValueEnd <= pBegin || pValueEnd[-1] != '}') return 0;
	{
		char *pInsertion = (char *)malloc(lWorkspaceJsonSize + 13u);
		int lResult;
		if(!pInsertion) return 0;
		pInsertion[0] = ',';
		memcpy(pInsertion + 1, "\"workspace\":", 12u);
		memcpy(pInsertion + 13, pWorkspaceJson, lWorkspaceJsonSize);
		lResult = A8E_LibraryRepository_ReplaceSpan(
			&pRepository->pManifest, &pRepository->lManifestSize,
			(uint32_t)(pValueEnd - pBegin - 1), (uint32_t)(pValueEnd - pBegin - 1),
			pInsertion, lWorkspaceJsonSize + 13u);
		free(pInsertion);
		return lResult;
	}
}

static int A8E_LibraryRepository_RemoveManifestObject(
	A8E_LibraryRepository_t *pRepository,
	const A8E_LibraryRepositoryRecord_t *pRecord)
{
	uint32_t lStart = pRecord->lObjectStart;
	uint32_t lEnd = pRecord->lObjectEnd + 1u;
	const char *pManifest = (const char *)pRepository->pManifest;
	while(lStart > 0u && isspace((unsigned char)pManifest[lStart - 1u])) lStart--;
	if(lStart > 0u && pManifest[lStart - 1u] == ',') lStart--;
	else
	{
		while(lEnd < pRepository->lManifestSize &&
			isspace((unsigned char)pManifest[lEnd])) lEnd++;
		if(lEnd < pRepository->lManifestSize && pManifest[lEnd] == ',') lEnd++;
	}
	return A8E_LibraryRepository_ReplaceSpan(
		&pRepository->pManifest, &pRepository->lManifestSize,
		lStart, lEnd, "", 0u);
}

int A8E_LibraryRepository_SaveWorkingCopy(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pEntryId,
	const uint8_t *pBytes,
	uint32_t lSize,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tStaged;
	A8E_LibraryRepositoryRecord_t *pRecord;
	char aHash[65];
	char sPath[80];
	const char *pType;
	char *pOldPath;
	char *pOldType;

	if(!pRepository || !pRootPath || !pEntryId || (lSize > 0u && !pBytes))
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid working copy");
		return 0;
	}
	A8E_LibraryRepository_Init(&tStaged);
	if(!A8E_LibraryRepository_LoadDirectory(
		&tStaged, pRootPath, pError, lErrorSize)) return 0;
	pRecord = A8E_LibraryRepository_FindRecord(&tStaged, pEntryId, NULL);
	if(!pRecord)
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "library entry not found");
		return 0;
	}
	A8E_LibraryPackage_Sha256Hex(pBytes, lSize, aHash);
	pType = strcmp(pRecord->pType, "xex") == 0 && lSize >= 2u &&
		pBytes[0] == 0x96u && pBytes[1] == 0x02u ? "atr" : pRecord->pType;
	snprintf(sPath, sizeof(sPath), "blobs/%s.%s", aHash, pType);
	pOldPath = A8E_LibraryRepository_DuplicateString(pRecord->pPath);
	pOldType = A8E_LibraryRepository_DuplicateString(pRecord->pType);
	if(!pOldPath || !pOldType || !A8E_LibraryRepository_AddPayload(&tStaged, sPath, pBytes, lSize) ||
		!A8E_LibraryRepository_ReplaceRecordFields(
			&tStaged, pRecord, pType, sPath, lSize, aHash) ||
		!A8E_LibraryRepository_IncrementVersion(&tStaged))
	{
		free(pOldPath);
		free(pOldType);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot update working copy");
		return 0;
	}
	free(pRecord->pPath);
	pRecord->pPath = A8E_LibraryRepository_DuplicateString(sPath);
	if(strcmp(pRecord->pType, pType) != 0)
	{
		free(pRecord->pType);
		pRecord->pType = A8E_LibraryRepository_DuplicateString(pType);
	}
	pRecord->lSize = lSize;
	if(!pRecord->pPath || !pRecord->pType)
	{
		free(pOldPath);
		free(pOldType);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
		return 0;
	}
	if(strcmp(pOldPath, sPath) != 0 &&
		!A8E_LibraryRepository_IsPayloadReferenced(&tStaged, pOldPath))
		A8E_LibraryRepository_RemovePayload(&tStaged, pOldPath);
	free(pOldPath);
	free(pOldType);
	if(!A8E_LibraryRepository_SaveDirectory(
		&tStaged, pRootPath, pError, lErrorSize) ||
		!A8E_LibraryRepository_LoadDirectory(
			pRepository, pRootPath, pError, lErrorSize))
	{
		A8E_LibraryRepository_Free(&tStaged);
		return 0;
	}
	A8E_LibraryRepository_Free(&tStaged);
	return 1;
}

int A8E_LibraryRepository_RemoveEntry(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pEntryId,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tStaged;
	A8E_LibraryRepositoryRecord_t *pRecord;
	uint16_t sIndex;
	uint16_t sRecordIndex;
	char *pOldPath;
	const char *apEntryIds[8];
	uint8_t abWriteProtected[8];
	char *pWorkspaceJson = NULL;
	uint32_t lWorkspaceJsonSize = 0;
	int bWorkspaceChanged = 0;

	if(!pRepository || !pRootPath || !pEntryId)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid library entry");
		return 0;
	}
	A8E_LibraryRepository_Init(&tStaged);
	if(!A8E_LibraryRepository_LoadDirectory(
		&tStaged, pRootPath, pError, lErrorSize)) return 0;
	pRecord = A8E_LibraryRepository_FindRecord(&tStaged, pEntryId, &sRecordIndex);
	if(!pRecord)
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "library entry not found");
		return 0;
	}
	pOldPath = A8E_LibraryRepository_DuplicateString(pRecord->pPath);
	if(!pOldPath || !A8E_LibraryRepository_RemoveManifestObject(&tStaged, pRecord))
	{
		free(pOldPath);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot remove library entry");
		return 0;
	}
	for(sIndex = 0; sIndex < 8u; sIndex++)
	{
		apEntryIds[sIndex] = tStaged.acDeviceEntryId[sIndex];
		abWriteProtected[sIndex] = tStaged.abDeviceWriteProtected[sIndex];
		if(strcmp(tStaged.acDeviceEntryId[sIndex], pEntryId) == 0)
		{
			apEntryIds[sIndex] = NULL;
			bWorkspaceChanged = 1;
		}
	}
	if(bWorkspaceChanged &&
		(!A8E_LibraryRepository_BuildWorkspaceJson(
			apEntryIds, abWriteProtected, &pWorkspaceJson, &lWorkspaceJsonSize) ||
			!A8E_LibraryRepository_ReplaceWorkspace(
				&tStaged, pWorkspaceJson, lWorkspaceJsonSize)))
	{
		free(pWorkspaceJson);
		free(pOldPath);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot update workspace");
		return 0;
	}
	free(pWorkspaceJson);
	if(!A8E_LibraryRepository_IncrementVersion(&tStaged))
	{
		free(pOldPath);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot remove library entry");
		return 0;
	}
	A8E_LibraryRepository_FreeRecordFields(pRecord);
	if(sRecordIndex + 1u < tStaged.sRecordCount)
		memmove(&tStaged.pRecords[sRecordIndex], &tStaged.pRecords[sRecordIndex + 1u],
			(size_t)(tStaged.sRecordCount - sRecordIndex - 1u) * sizeof(*tStaged.pRecords));
	tStaged.sRecordCount--;
	if(!A8E_LibraryRepository_IsPayloadReferenced(&tStaged, pOldPath))
		A8E_LibraryRepository_RemovePayload(&tStaged, pOldPath);
	free(pOldPath);
	if(!A8E_LibraryRepository_SaveDirectory(
		&tStaged, pRootPath, pError, lErrorSize) ||
		!A8E_LibraryRepository_LoadDirectory(
			pRepository, pRootPath, pError, lErrorSize))
	{
		A8E_LibraryRepository_Free(&tStaged);
		return 0;
	}
	A8E_LibraryRepository_Free(&tStaged);
	return 1;
}

int A8E_LibraryRepository_SaveWorkspace(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *apEntryIds[8],
	const uint8_t abWriteProtected[8],
	char *pError,
	uint32_t lErrorSize)
{
	char *pWorkspaceJson = NULL;
	uint8_t *pOriginalManifest = NULL;
	uint32_t lOriginalManifestSize;
	uint32_t lOriginalVersion;
	uint32_t lWorkspaceJsonSize = 0;
	uint32_t lDrive;
	uint16_t sIndex;

	if(!pRepository || !pRootPath || !apEntryIds)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid workspace");
		return 0;
	}
	if(pError && lErrorSize > 0) pError[0] = '\0';
	for(lDrive = 0; lDrive < 8u; lDrive++)
	{
		if(!apEntryIds[lDrive] || !apEntryIds[lDrive][0]) continue;
		for(sIndex = 0; sIndex < pRepository->sRecordCount; sIndex++)
			if(strcmp(apEntryIds[lDrive], pRepository->pRecords[sIndex].pId) == 0) break;
		if(sIndex == pRepository->sRecordCount)
		{
			A8E_LibraryRepository_SetError(
				pError, lErrorSize, "workspace entry not found");
			return 0;
		}
		for(sIndex = 0; sIndex < lDrive; sIndex++)
			if(apEntryIds[sIndex] && apEntryIds[sIndex][0] &&
				strcmp(apEntryIds[sIndex], apEntryIds[lDrive]) == 0)
			{
				A8E_LibraryRepository_SetError(
					pError, lErrorSize, "entry mounted in two devices");
				return 0;
			}
	}
	if(!A8E_LibraryRepository_BuildWorkspaceJson(
		apEntryIds, abWriteProtected, &pWorkspaceJson, &lWorkspaceJsonSize))
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot build workspace");
		return 0;
	}
	if(!pRepository->pManifest || pRepository->lManifestSize == 0u)
	{
		free(pWorkspaceJson);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "repository is incomplete");
		return 0;
	}
	lOriginalManifestSize = pRepository->lManifestSize;
	lOriginalVersion = pRepository->lLibraryVersion;
	pOriginalManifest = (uint8_t *)malloc(lOriginalManifestSize);
	if(!pOriginalManifest)
	{
		free(pWorkspaceJson);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
		return 0;
	}
	memcpy(pOriginalManifest, pRepository->pManifest, lOriginalManifestSize);
	if(!A8E_LibraryRepository_ReplaceWorkspace(
		pRepository, pWorkspaceJson, lWorkspaceJsonSize) ||
		!A8E_LibraryRepository_IncrementVersion(pRepository) ||
		!A8E_LibraryRepository_SaveManifest(
			pRepository, pRootPath, pError, lErrorSize))
	{
		free(pRepository->pManifest);
		pRepository->pManifest = pOriginalManifest;
		pRepository->lManifestSize = lOriginalManifestSize;
		pRepository->lLibraryVersion = lOriginalVersion;
		free(pWorkspaceJson);
		if(!pError || !pError[0]) A8E_LibraryRepository_SetError(
			pError, lErrorSize, "cannot save workspace");
		return 0;
	}
	free(pOriginalManifest);
	free(pWorkspaceJson);
	for(lDrive = 0; lDrive < 8u; lDrive++)
	{
		pRepository->acDeviceEntryId[lDrive][0] = '\0';
		if(apEntryIds[lDrive] && apEntryIds[lDrive][0])
		{
			strncpy(pRepository->acDeviceEntryId[lDrive], apEntryIds[lDrive],
				sizeof(pRepository->acDeviceEntryId[lDrive]) - 1u);
			pRepository->acDeviceEntryId[lDrive][
				sizeof(pRepository->acDeviceEntryId[lDrive]) - 1u] = '\0';
		}
		pRepository->abDeviceWriteProtected[lDrive] = abWriteProtected
			? abWriteProtected[lDrive] : 0u;
	}
	return 1;
}

int A8E_LibraryRepository_ImportPackageFile(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pPackagePath,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tStaged;
	A8E_LibraryArchiveEntry_t *pEntries = NULL;
	uint8_t *pArchive = NULL;
	uint32_t lArchiveSize = 0;
	uint32_t lLibraryVersion = 0;
	uint16_t sEntryCount = 0;
	uint16_t sManifestIndex = 0xffffu;
	uint16_t i;

	if(!pRepository || !pRootPath || !pPackagePath)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid package import");
		return 0;
	}
	if(!A8E_LibraryRepository_ReadFile(
		pPackagePath, &pArchive, &lArchiveSize, pError, lErrorSize) ||
		!A8E_LibraryPackage_Read(
			pArchive, lArchiveSize, &pEntries, &sEntryCount,
			&lLibraryVersion, pError, lErrorSize))
	{
		free(pArchive);
		return 0;
	}
	for(i = 0; i < sEntryCount; i++)
		if(strcmp(pEntries[i].pName, "library.json") == 0)
		{
			sManifestIndex = i;
			break;
		}
	if(sManifestIndex == 0xffffu)
	{
		A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
		free(pArchive);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "library.json is missing");
		return 0;
	}
	A8E_LibraryRepository_Init(&tStaged);
	tStaged.pManifest = (uint8_t *)malloc(pEntries[sManifestIndex].lSize);
	if(!tStaged.pManifest)
	{
		A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
		free(pArchive);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
		return 0;
	}
	memcpy(tStaged.pManifest, pEntries[sManifestIndex].pBytes,
		pEntries[sManifestIndex].lSize);
	tStaged.lManifestSize = pEntries[sManifestIndex].lSize;
	tStaged.lLibraryVersion = lLibraryVersion;
	if(!A8E_LibraryRepository_ParseManifest(&tStaged, pError, lErrorSize))
	{
		A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
		free(pArchive);
		A8E_LibraryRepository_Free(&tStaged);
		return 0;
	}
	A8E_LibraryRepository_ParseWorkspace(&tStaged);
	for(i = 0; i < sEntryCount; i++)
	{
		if(i == sManifestIndex) continue;
		if(!A8E_LibraryRepository_AddPayload(
			&tStaged, pEntries[i].pName, pEntries[i].pBytes, pEntries[i].lSize))
		{
			A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
			free(pArchive);
			A8E_LibraryRepository_Free(&tStaged);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot stage package payload");
			return 0;
		}
	}
	A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
	free(pArchive);
	if(!A8E_LibraryRepository_SaveDirectory(
		&tStaged, pRootPath, pError, lErrorSize) ||
		!A8E_LibraryRepository_LoadDirectory(
			pRepository, pRootPath, pError, lErrorSize))
	{
		A8E_LibraryRepository_Free(&tStaged);
		return 0;
	}
	A8E_LibraryRepository_Free(&tStaged);
	return 1;
}

int A8E_LibraryRepository_ExportPackageFile(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPackagePath,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryArchiveInput_t *pInputs = NULL;
	uint8_t *pArchive = NULL;
	uint32_t lArchiveSize = 0;
	uint16_t i;
	int lResult;
	if(!pRepository || !pPackagePath || !pRepository->pManifest)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid package export");
		return 0;
	}
	if(pRepository->sPayloadCount > 0)
	{
		pInputs = (A8E_LibraryArchiveInput_t *)calloc(
			pRepository->sPayloadCount, sizeof(*pInputs));
		if(!pInputs)
		{
			A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
			return 0;
		}
	}
	for(i = 0; i < pRepository->sPayloadCount; i++)
	{
		pInputs[i].pName = pRepository->pPayloads[i].pName;
		pInputs[i].pBytes = pRepository->pPayloads[i].pBytes;
		pInputs[i].lSize = pRepository->pPayloads[i].lSize;
	}
	lResult = A8E_LibraryPackage_Write(
		pRepository->pManifest, pRepository->lManifestSize,
		pInputs, pRepository->sPayloadCount, &pArchive, &lArchiveSize,
		pError, lErrorSize);
	free(pInputs);
	if(!lResult) return 0;
	lResult = A8E_LibraryRepository_WriteFile(
		pPackagePath, pArchive, lArchiveSize, pError, lErrorSize);
	free(pArchive);
	return lResult;
}

int A8E_LibraryRepository_CreateBlankAtr(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pName,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tStaged;
	uint8_t *pBytes = NULL;
	uint32_t lSize = 0;
	uint32_t lVersion;
	char aHash[65];
	char sPath[80];
	char sId[80];
	char sTime[48];
	char *pRecordJson = NULL;
	uint32_t lRecordSize = 0;
	const char *pBegin;
	const char *pEnd;
	const char *pArray;
	const char *pArrayEnd;
	uint32_t lInsert;
	uint32_t i;
	int bExistingRoot;

	if(!pRepository || !pRootPath || !pName || !pName[0] ||
		strlen(pName) > 256u || strchr(pName, '/') || strchr(pName, '\\'))
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid ATR name");
		return 0;
	}
	{
		const size_t lNameLength = strlen(pName);
		const char *pExtension = lNameLength >= 4u ? pName + lNameLength - 4u : NULL;
		if(!pExtension || tolower((unsigned char)pExtension[0]) != '.' ||
			tolower((unsigned char)pExtension[1]) != 'a' ||
			tolower((unsigned char)pExtension[2]) != 't' ||
			tolower((unsigned char)pExtension[3]) != 'r')
		{
			A8E_LibraryRepository_SetError(pError, lErrorSize, "blank disk name must end in .atr");
			return 0;
		}
	}
	A8E_LibraryRepository_Init(&tStaged);
	if(!A8E_LibraryRepository_LoadDirectory(
		&tStaged, pRootPath, pError, lErrorSize))
	{
		char sManifestPath[A8E_REPOSITORY_MAX_PATH];
		FILE *pManifestFile;
		A8E_LibraryRepository_Free(&tStaged);
		if(!A8E_LibraryRepository_JoinPath(
			sManifestPath, sizeof(sManifestPath), pRootPath, "library.json"))
			return 0;
		pManifestFile = fopen(sManifestPath, "rb");
		if(pManifestFile)
		{
			fclose(pManifestFile);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot load library directory");
			return 0;
		}
		A8E_LibraryRepository_Init(&tStaged);
		{
			time_t lNow = time(NULL);
			struct tm *pUtc = gmtime(&lNow);
			if(!pUtc || strftime(sTime, sizeof(sTime), "%Y-%m-%dT%H:%M:%SZ", pUtc) == 0 ||
				!A8E_LibraryRepository_AppendJsonLiteral(
					(char *)(tStaged.pManifest = (uint8_t *)malloc(512u)), 512u,
					&tStaged.lManifestSize,
					"{\"format\":\"a8e-library-export\",\"schemaVersion\":1,\"libraryVersion\":1,\"createdAt\":\""))
			{
				A8E_LibraryRepository_Free(&tStaged);
				A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot create library manifest");
				return 0;
			}
			A8E_LibraryRepository_AppendJsonLiteral(
				(char *)tStaged.pManifest, 512u, &tStaged.lManifestSize, sTime);
			A8E_LibraryRepository_AppendJsonLiteral(
				(char *)tStaged.pManifest, 512u, &tStaged.lManifestSize,
				"\",\"library\":[]}");
			tStaged.lManifestSize = (uint32_t)strlen((char *)tStaged.pManifest);
			tStaged.lLibraryVersion = 1;
			if(!A8E_LibraryPackage_ValidateManifest(
				tStaged.pManifest, tStaged.lManifestSize, &lVersion,
				pError, lErrorSize))
			{
				A8E_LibraryRepository_Free(&tStaged);
				return 0;
			}
			if(!A8E_LibraryRepository_ParseManifest(&tStaged, pError, lErrorSize))
			{
				A8E_LibraryRepository_Free(&tStaged);
				return 0;
			}
		}
	}
	for(i = 1u; i < 10000u; i++)
	{
		snprintf(sId, sizeof(sId), "native-blank-%u", i);
		if(!A8E_LibraryRepository_FindRecord(&tStaged, sId, NULL)) break;
	}
	if(i == 10000u)
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "too many blank ATR entries");
		return 0;
	}
	for(i = 0; i < tStaged.sRecordCount; i++)
		if(strcmp(tStaged.pRecords[i].pName, pName) == 0)
		{
			A8E_LibraryRepository_Free(&tStaged);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "duplicate ATR name");
			return 0;
		}
	if(!A8E_LibraryImage_CreateBlankAtr(&pBytes, &lSize))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot create blank ATR");
		return 0;
	}
	A8E_LibraryPackage_Sha256Hex(pBytes, lSize, aHash);
	snprintf(sPath, sizeof(sPath), "blobs/%s.atr", aHash);
	pRecordJson = (char *)malloc(2048u);
	if(!pRecordJson)
	{
		free(pBytes);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
		return 0;
	}
	{
		time_t lNow = time(NULL);
		struct tm *pUtc = gmtime(&lNow);
		if(!pUtc || strftime(sTime, sizeof(sTime), "%Y-%m-%dT%H:%M:%SZ", pUtc) == 0)
		{
			free(pRecordJson); free(pBytes); A8E_LibraryRepository_Free(&tStaged);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot create ATR timestamp");
			return 0;
		}
		pRecordJson[0] = '{'; lRecordSize = 1;
		if(!A8E_LibraryRepository_AppendJsonLiteral(pRecordJson, 2048u, &lRecordSize, "\"id\":") ||
			!A8E_LibraryRepository_AppendJsonString(pRecordJson, 2048u, &lRecordSize, sId) ||
			!A8E_LibraryRepository_AppendJsonLiteral(pRecordJson, 2048u, &lRecordSize, ",\"name\":") ||
			!A8E_LibraryRepository_AppendJsonString(pRecordJson, 2048u, &lRecordSize, pName) ||
			!A8E_LibraryRepository_AppendJsonLiteral(pRecordJson, 2048u, &lRecordSize, ",\"type\":\"atr\",\"path\":") ||
			!A8E_LibraryRepository_AppendJsonString(pRecordJson, 2048u, &lRecordSize, sPath))
		{
			free(pRecordJson); free(pBytes); A8E_LibraryRepository_Free(&tStaged);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot build ATR record");
			return 0;
		}
		{
			char sSize[32];
			snprintf(sSize, sizeof(sSize), "%u", lSize);
			A8E_LibraryRepository_AppendJsonLiteral(pRecordJson, 2048u, &lRecordSize, ",\"size\":");
			A8E_LibraryRepository_AppendJsonLiteral(pRecordJson, 2048u, &lRecordSize, sSize);
		}
		A8E_LibraryRepository_AppendJsonLiteral(pRecordJson, 2048u, &lRecordSize, ",\"sha256\":");
		A8E_LibraryRepository_AppendJsonString(pRecordJson, 2048u, &lRecordSize, aHash);
		A8E_LibraryRepository_AppendJsonLiteral(pRecordJson, 2048u, &lRecordSize, ",\"createdAt\":");
		A8E_LibraryRepository_AppendJsonString(pRecordJson, 2048u, &lRecordSize, sTime);
		A8E_LibraryRepository_AppendJsonLiteral(pRecordJson, 2048u, &lRecordSize, ",\"modifiedAt\":");
		A8E_LibraryRepository_AppendJsonString(pRecordJson, 2048u, &lRecordSize, sTime);
		A8E_LibraryRepository_AppendJsonLiteral(pRecordJson, 2048u, &lRecordSize, ",\"mountedSlot\":-1,\"folderId\":\"root\"}");
	}
	pRecordJson[lRecordSize] = '\0';
	pBegin = (const char *)tStaged.pManifest;
	pEnd = pBegin + tStaged.lManifestSize;
	pArray = A8E_LibraryRepository_FindKey(pBegin, pEnd, "library");
	pArrayEnd = pArray && *pArray == '['
		? A8E_LibraryRepository_Match(pArray, pEnd, '[', ']') : NULL;
	if(!pArrayEnd)
	{
		free(pRecordJson); free(pBytes); A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid library records");
		return 0;
	}
	lInsert = (uint32_t)(pArrayEnd - pBegin);
	bExistingRoot = 0;
	{
		const char *pFirst = A8E_LibraryRepository_SkipSpace(pArray + 1, pArrayEnd);
		bExistingRoot = pFirst < pArrayEnd;
	}
	{
		uint32_t lInsertionSize = lRecordSize + (bExistingRoot ? 1u : 0u);
		char *pInsertion = (char *)malloc(lInsertionSize);
		int lResult;
		if(!pInsertion)
		{
			free(pRecordJson); free(pBytes); A8E_LibraryRepository_Free(&tStaged);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
			return 0;
		}
		if(bExistingRoot) pInsertion[0] = ',';
		memcpy(pInsertion + (bExistingRoot ? 1u : 0u), pRecordJson, lRecordSize);
		lResult = A8E_LibraryRepository_ReplaceSpan(
			&tStaged.pManifest, &tStaged.lManifestSize,
			lInsert, lInsert, pInsertion, lInsertionSize);
		free(pInsertion);
		if(!lResult || !A8E_LibraryRepository_AddPayload(
			&tStaged, sPath, pBytes, lSize) ||
			!A8E_LibraryRepository_IncrementVersion(&tStaged) ||
			!A8E_LibraryRepository_SaveDirectory(
				&tStaged, pRootPath, pError, lErrorSize) ||
			!A8E_LibraryRepository_LoadDirectory(
				pRepository, pRootPath, pError, lErrorSize))
		{
			free(pRecordJson); free(pBytes); A8E_LibraryRepository_Free(&tStaged);
			return 0;
		}
	}
	free(pRecordJson);
	free(pBytes);
	A8E_LibraryRepository_Free(&tStaged);
	return 1;
}

int A8E_LibraryRepository_SaveDirectory(
	const A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	char *pError,
	uint32_t lErrorSize)
{
	char sBlobsPath[A8E_REPOSITORY_MAX_PATH];
	char sPath[A8E_REPOSITORY_MAX_PATH];
	char sTempPath[A8E_REPOSITORY_MAX_PATH];
	uint16_t i;
	A8E_LibraryArchiveInput_t *pInputs = NULL;
	uint8_t *pArchive = NULL;
	uint32_t lArchiveSize = 0;

	if(!pRepository || !pRootPath || !pRepository->pManifest)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "repository is incomplete");
		return 0;
	}
	if(pRepository->sPayloadCount > 0)
	{
		pInputs = (A8E_LibraryArchiveInput_t *)calloc(
			pRepository->sPayloadCount, sizeof(*pInputs));
		if(!pInputs)
		{
			A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
			return 0;
		}
	}
	for(i = 0; i < pRepository->sPayloadCount; i++)
	{
		pInputs[i].pName = pRepository->pPayloads[i].pName;
		pInputs[i].pBytes = pRepository->pPayloads[i].pBytes;
		pInputs[i].lSize = pRepository->pPayloads[i].lSize;
	}
	if(!A8E_LibraryPackage_Write(
		pRepository->pManifest, pRepository->lManifestSize,
		pInputs, pRepository->sPayloadCount, &pArchive, &lArchiveSize,
		pError, lErrorSize))
	{
		free(pInputs);
		return 0;
	}
	free(pInputs);
	free(pArchive);
	if(!A8E_LibraryRepository_MakeDirectory(pRootPath, pError, lErrorSize) ||
		!A8E_LibraryRepository_JoinPath(
			sBlobsPath, sizeof(sBlobsPath), pRootPath, "blobs") ||
		!A8E_LibraryRepository_MakeDirectory(sBlobsPath, pError, lErrorSize)) return 0;
	for(i = 0; i < pRepository->sPayloadCount; i++)
	{
		if(!pRepository->pPayloads[i].pName ||
			!A8E_LibraryRepository_JoinPath(
				sPath, sizeof(sPath), pRootPath, pRepository->pPayloads[i].pName) ||
			!A8E_LibraryRepository_JoinPath(
				sTempPath, sizeof(sTempPath), pRootPath, "blobs/.a8e-payload.tmp") ||
			!A8E_LibraryRepository_WriteFile(
				sTempPath, pRepository->pPayloads[i].pBytes,
				pRepository->pPayloads[i].lSize, pError, lErrorSize)) return 0;
		remove(sPath);
		if(rename(sTempPath, sPath) != 0)
		{
			remove(sTempPath);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot install library blob");
			return 0;
		}
	}
	if(!A8E_LibraryRepository_JoinPath(
		sTempPath, sizeof(sTempPath), pRootPath, "library.json.tmp") ||
		!A8E_LibraryRepository_WriteFile(
			sTempPath, pRepository->pManifest, pRepository->lManifestSize,
			pError, lErrorSize)) return 0;
	if(!A8E_LibraryRepository_JoinPath(
		sPath, sizeof(sPath), pRootPath, "library.json")) return 0;
	remove(sPath);
	if(rename(sTempPath, sPath) != 0)
	{
		remove(sTempPath);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot install library manifest");
		return 0;
	}
	return 1;
}
