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

static char *A8E_LibraryRepository_DuplicateString(const char *pText);
static int A8E_LibraryRepository_AppendObjectField(
	uint8_t **ppObject,
	uint32_t *pObjectSize,
	const char *pKey,
	const char *pValue);

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
	pRecord->lObjectEnd = pRecord->lObjectStart + lObjectSize - 1u;
	free(pObject);
	return 1;
}

static int A8E_LibraryRepository_AppendRevision(
	A8E_LibraryRepository_t *pRepository,
	A8E_LibraryRepositoryRecord_t *pRecord,
	const char *pPath,
	uint32_t lSize,
	const uint8_t *pBytes)
{
	uint8_t *pObject;
	uint32_t lObjectSize;
	char aHash[65];
	char sRevision[2048];
	char sTime[48];
	char sId[96];
	time_t lNow = time(NULL);
	struct tm *pUtc = gmtime(&lNow);
	const char *pBegin;
	const char *pEnd;
	const char *pValue;
	const char *pArrayEnd;
	uint32_t lRevisionSize;
	if(!pRepository || !pRecord || !pPath || (!pBytes && lSize)) return 0;
	if(!pUtc || strftime(sTime, sizeof(sTime), "%Y-%m-%dT%H:%M:%SZ", pUtc) == 0) return 0;
	A8E_LibraryPackage_Sha256Hex(pBytes, lSize, aHash);
	snprintf(sId, sizeof(sId), "revision-%u-%s", pRepository->lLibraryVersion + 1u, aHash);
	lRevisionSize = (uint32_t)snprintf(sRevision, sizeof(sRevision),
		"{\"id\":\"%s\",\"path\":\"%s\",\"size\":%u,\"sha256\":\"%s\",\"createdAt\":\"%s\",\"modifiedAt\":\"%s\"}",
		sId, pPath, lSize, aHash, sTime, sTime);
	if(lRevisionSize >= sizeof(sRevision)) return 0;
	pBegin = (const char *)pRepository->pManifest + pRecord->lObjectStart;
	lObjectSize = pRecord->lObjectEnd - pRecord->lObjectStart + 1u;
	pObject = (uint8_t *)malloc(lObjectSize);
	if(!pObject) return 0;
	memcpy(pObject, pBegin, lObjectSize);
	pEnd = (const char *)pObject + lObjectSize;
	pValue = A8E_LibraryRepository_FindKey(pEnd - lObjectSize, pEnd, "revisions");
	if(!pValue)
	{
		char sArray[2052];
		snprintf(sArray, sizeof(sArray), "[%s]", sRevision);
		if(!A8E_LibraryRepository_AppendObjectField(
			&pObject, &lObjectSize, "revisions", sArray))
		{
			free(pObject);
			return 0;
		}
	}
	else
	{
		const char *pObjectBegin = (const char *)pObject;
		const char *pArray = pValue;
		char *pReplacement;
		uint32_t lArraySize;
		uint32_t lReplacementSize;
		pArrayEnd = A8E_LibraryRepository_Match(pArray, pEnd, '[', ']');
		if(!pArrayEnd)
		{
			free(pObject);
			return 0;
		}
		lArraySize = (uint32_t)(pArrayEnd - pArray + 1u);
		pReplacement = (char *)malloc(lArraySize + lRevisionSize + 2u);
		if(!pReplacement)
		{
			free(pObject);
			return 0;
		}
		memcpy(pReplacement, pArray, lArraySize - 1u);
		lReplacementSize = lArraySize - 1u;
		if(lReplacementSize > 1u) pReplacement[lReplacementSize++] = ',';
		memcpy(pReplacement + lReplacementSize, sRevision, lRevisionSize);
		lReplacementSize += lRevisionSize;
		pReplacement[lReplacementSize++] = ']';
		if(!A8E_LibraryRepository_ReplaceSpan(
			&pObject, &lObjectSize,
			(uint32_t)(pArray - pObjectBegin),
			(uint32_t)(pArrayEnd - pObjectBegin + 1u),
			pReplacement, lReplacementSize))
		{
			free(pReplacement);
			free(pObject);
			return 0;
		}
		free(pReplacement);
	}
	if(!A8E_LibraryRepository_ReplaceSpan(
		&pRepository->pManifest, &pRepository->lManifestSize,
		pRecord->lObjectStart, pRecord->lObjectEnd + 1u,
		(const char *)pObject, lObjectSize))
	{
		free(pObject);
		return 0;
	}
	pRecord->lObjectEnd = pRecord->lObjectStart + lObjectSize - 1u;
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
	free(pRecord->pModifiedAt);
	free(pRecord->pDeletedAt);
	free(pRecord->pPreferredRevisionId);
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

static void A8E_LibraryRepository_FreeFolderFields(
	A8E_LibraryRepositoryFolder_t *pFolder)
{
	if(!pFolder) return;
	free(pFolder->pId);
	free(pFolder->pName);
	free(pFolder->pParentId);
}

static void A8E_LibraryRepository_FreeFolders(
	A8E_LibraryRepositoryFolder_t *pFolders,
	uint16_t sFolderCount)
{
	uint16_t i;
	if(!pFolders) return;
	for(i = 0; i < sFolderCount; i++)
		A8E_LibraryRepository_FreeFolderFields(&pFolders[i]);
	free(pFolders);
}

static int A8E_LibraryRepository_ParseFolders(
	A8E_LibraryRepository_t *pRepository,
	char *pError,
	uint32_t lErrorSize)
{
	const char *pBegin = (const char *)pRepository->pManifest;
	const char *pEnd = pBegin + pRepository->lManifestSize;
	const char *pArray = A8E_LibraryRepository_FindKey(pBegin, pEnd, "folders");
	const char *pArrayEnd;
	const char *p;

	if(!pArray) return 1;
	if(*pArray != '[' || !(pArrayEnd = A8E_LibraryRepository_Match(
		pArray, pEnd, '[', ']')))
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid folders");
		return 0;
	}
	for(p = pArray + 1; p < pArrayEnd; p++)
	{
		const char *pObject = p;
		const char *pObjectEnd;
		A8E_LibraryRepositoryFolder_t tFolder;
		memset(&tFolder, 0, sizeof(tFolder));
		if(*p != '{') continue;
		pObjectEnd = A8E_LibraryRepository_Match(pObject, pArrayEnd + 1, '{', '}');
		if(!pObjectEnd)
		{
			A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid folder object");
			return 0;
		}
		tFolder.pId = A8E_LibraryRepository_ReadString(
			A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "id"), pObjectEnd + 1);
		tFolder.pName = A8E_LibraryRepository_ReadString(
			A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "name"), pObjectEnd + 1);
		tFolder.pParentId = A8E_LibraryRepository_ReadString(
			A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "parentId"), pObjectEnd + 1);
		if(!tFolder.pId || !tFolder.pName ||
			(tFolder.pParentId && strcmp(tFolder.pId, "root") == 0))
		{
			A8E_LibraryRepository_FreeFolderFields(&tFolder);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid folder fields");
			return 0;
		}
		tFolder.lObjectStart = (uint32_t)(pObject - pBegin);
		tFolder.lObjectEnd = (uint32_t)(pObjectEnd - pBegin);
		if(pRepository->sFolderCount == 0xffffu)
		{
			A8E_LibraryRepository_FreeFolderFields(&tFolder);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "too many folders");
			return 0;
		}
		{
			A8E_LibraryRepositoryFolder_t *pFolders =
				(A8E_LibraryRepositoryFolder_t *)realloc(
				pRepository->pFolders,
				(size_t)(pRepository->sFolderCount + 1u) * sizeof(*pFolders));
			if(!pFolders)
			{
				A8E_LibraryRepository_FreeFolderFields(&tFolder);
				A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
				return 0;
			}
			pRepository->pFolders = pFolders;
			pRepository->pFolders[pRepository->sFolderCount++] = tFolder;
		}
		p = pObjectEnd;
	}
	return 1;
}

static int A8E_LibraryRepository_ParseRecordArray(
	A8E_LibraryRepository_t *pRepository,
	const char *pArrayKey,
	A8E_LibraryRepositoryRecord_t **ppRecords,
	uint16_t *pRecordCount,
	char *pError,
	uint32_t lErrorSize);

static int A8E_LibraryRepository_ParseRevisionSummary(
	const char *pObject,
	const char *pObjectEnd,
	uint16_t *pRevisionCount,
	char **ppPreferredRevisionId)
{
	const char *pArray;
	const char *pArrayEnd;
	const char *p;
	uint16_t lCount = 0;
	if(pRevisionCount) *pRevisionCount = 0;
	if(ppPreferredRevisionId) *ppPreferredRevisionId = NULL;
	if(!pObject || !pObjectEnd) return 0;
	pArray = A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "revisions");
	if(pArray)
	{
		if(*pArray != '[' || !(pArrayEnd = A8E_LibraryRepository_Match(
			pArray, pObjectEnd + 1, '[', ']'))) return 0;
		for(p = pArray + 1; p < pArrayEnd; p++)
		{
			const char *pRevisionEnd;
			if(*p != '{') continue;
			pRevisionEnd = A8E_LibraryRepository_Match(
				p, pArrayEnd + 1, '{', '}');
			if(!pRevisionEnd || lCount == 0xffffu) return 0;
			lCount++;
			p = pRevisionEnd;
		}
	}
	if(ppPreferredRevisionId)
	{
		*ppPreferredRevisionId = A8E_LibraryRepository_ReadString(
			A8E_LibraryRepository_FindKey(
				pObject, pObjectEnd + 1, "preferredRevisionId"),
			pObjectEnd + 1);
	}
	if(pRevisionCount) *pRevisionCount = lCount;
	return 1;
}

static int A8E_LibraryRepository_ParseRecordArray(
	A8E_LibraryRepository_t *pRepository,
	const char *pArrayKey,
	A8E_LibraryRepositoryRecord_t **ppRecords,
	uint16_t *pRecordCount,
	char *pError,
	uint32_t lErrorSize)
{
	const char *pBegin = (const char *)pRepository->pManifest;
	const char *pEnd = pBegin + pRepository->lManifestSize;
	const char *pArray = A8E_LibraryRepository_FindKey(pBegin, pEnd, pArrayKey);
	const char *pArrayEnd;
	const char *p;

	if(!pArray) return 1;
	if(*pArray != '[' ||
		!(pArrayEnd = A8E_LibraryRepository_Match(pArray, pEnd, '[', ']')))
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid library record array");
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
		tRecord.pFolderId = A8E_LibraryRepository_ReadString(
			A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "folderId"),
			pObjectEnd + 1);
		if(!tRecord.pFolderId)
			tRecord.pFolderId = A8E_LibraryRepository_DuplicateString("root");
		tRecord.pModifiedAt = A8E_LibraryRepository_ReadString(
			A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "modifiedAt"),
			pObjectEnd + 1);
		if(!tRecord.pModifiedAt)
			tRecord.pModifiedAt = A8E_LibraryRepository_DuplicateString("");
		tRecord.pDeletedAt = A8E_LibraryRepository_ReadString(
			A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "deletedAt"),
			pObjectEnd + 1);
		if(!A8E_LibraryRepository_ParseRevisionSummary(
			pObject, pObjectEnd, &tRecord.sRevisionCount,
			&tRecord.pPreferredRevisionId))
		{
			A8E_LibraryRepository_FreeRecordFields(&tRecord);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid revision metadata");
			return 0;
		}
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
		if(!tRecord.pFolderId)
		{
			A8E_LibraryRepository_FreeRecordFields(&tRecord);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
			return 0;
		}
		if(!ppRecords || !pRecordCount || *pRecordCount == 0xffffu)
		{
			A8E_LibraryRepository_FreeRecordFields(&tRecord);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "too many library records");
			return 0;
		}
		{
			A8E_LibraryRepositoryRecord_t *pRecords = (A8E_LibraryRepositoryRecord_t *)realloc(
				*ppRecords,
				(size_t)(*pRecordCount + 1u) * sizeof(*pRecords));
			if(!pRecords)
			{
				A8E_LibraryRepository_FreeRecordFields(&tRecord);
				A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
				return 0;
			}
			*ppRecords = pRecords;
			pRecords[(*pRecordCount)++] = tRecord;
		}
		p = pObjectEnd;
	}
	return 1;
}

static int A8E_LibraryRepository_ParseManifest(
	A8E_LibraryRepository_t *pRepository,
	char *pError,
	uint32_t lErrorSize)
{
	const char *pBegin = (const char *)pRepository->pManifest;
	const char *pEnd = pBegin + pRepository->lManifestSize;
	const char *pLibrary = A8E_LibraryRepository_FindKey(pBegin, pEnd, "library");
	if(!pLibrary || *pLibrary != '[' ||
		!A8E_LibraryRepository_ParseRecordArray(
			pRepository, "library", &pRepository->pRecords,
			&pRepository->sRecordCount, pError, lErrorSize))
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid library records");
		return 0;
	}
	return A8E_LibraryRepository_ParseRecordArray(
		pRepository, "trash", &pRepository->pTrashRecords,
		&pRepository->sTrashCount, pError, lErrorSize);
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
	A8E_LibraryRepository_FreeRecords(pRepository->pTrashRecords, pRepository->sTrashCount);
	A8E_LibraryRepository_FreeFolders(pRepository->pFolders, pRepository->sFolderCount);
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
		!A8E_LibraryRepository_ParseFolders(&tStaged, pError, lErrorSize) ||
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

const A8E_LibraryRepositoryRecord_t *A8E_LibraryRepository_GetTrashRecord(
	const A8E_LibraryRepository_t *pRepository,
	uint16_t sIndex)
{
	if(!pRepository || sIndex >= pRepository->sTrashCount) return NULL;
	return &pRepository->pTrashRecords[sIndex];
}

const A8E_LibraryRepositoryFolder_t *A8E_LibraryRepository_GetFolder(
	const A8E_LibraryRepository_t *pRepository,
	uint16_t sIndex)
{
	if(!pRepository || sIndex >= pRepository->sFolderCount) return NULL;
	return &pRepository->pFolders[sIndex];
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
	for(i = 0; i < pRepository->sTrashCount; i++)
		if(strcmp(pRepository->pTrashRecords[i].pPath, pPath) == 0) return 1;
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

static A8E_LibraryRepositoryRecord_t *A8E_LibraryRepository_FindTrashRecord(
	A8E_LibraryRepository_t *pRepository,
	const char *pEntryId,
	uint16_t *pIndex)
{
	uint16_t i;
	if(!pRepository || !pEntryId) return NULL;
	for(i = 0; i < pRepository->sTrashCount; i++)
		if(strcmp(pRepository->pTrashRecords[i].pId, pEntryId) == 0)
		{
			if(pIndex) *pIndex = i;
			return &pRepository->pTrashRecords[i];
		}
	return NULL;
}

static int A8E_LibraryRepository_FindRevision(
	const A8E_LibraryRepository_t *pRepository,
	const A8E_LibraryRepositoryRecord_t *pRecord,
	const char *pRevisionId,
	char **ppPath,
	char **ppModifiedAt,
	uint32_t *pSize)
{
	const char *pBegin;
	const char *pObject;
	const char *pArray;
	const char *pArrayEnd;
	if(ppPath) *ppPath = NULL;
	if(ppModifiedAt) *ppModifiedAt = NULL;
	if(pSize) *pSize = 0;
	if(!pRepository || !pRecord || !pRevisionId) return 0;
	pBegin = (const char *)pRepository->pManifest + pRecord->lObjectStart;
	pArray = A8E_LibraryRepository_FindKey(
		pBegin, (const char *)pRepository->pManifest + pRecord->lObjectEnd + 1u,
		"revisions");
	if(!pArray || *pArray != '[' ||
		!(pArrayEnd = A8E_LibraryRepository_Match(
			pArray, (const char *)pRepository->pManifest + pRecord->lObjectEnd + 1u,
			'[', ']'))) return 0;
	for(pObject = pArray + 1; pObject < pArrayEnd; pObject++)
	{
		const char *pObjectEnd;
		char *pId;
		char *pPath;
		char *pModifiedAt;
		int32_t lValue;
		if(*pObject != '{') continue;
		pObjectEnd = A8E_LibraryRepository_Match(pObject, pArrayEnd + 1, '{', '}');
		if(!pObjectEnd) return 0;
		pId = A8E_LibraryRepository_ReadString(
			A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "id"), pObjectEnd + 1);
		if(!pId) return 0;
		if(strcmp(pId, pRevisionId) != 0)
		{
			free(pId);
			pObject = pObjectEnd;
			continue;
		}
		free(pId);
		pPath = A8E_LibraryRepository_ReadString(
			A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "path"), pObjectEnd + 1);
		pModifiedAt = A8E_LibraryRepository_ReadString(
			A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "modifiedAt"), pObjectEnd + 1);
		if(!pPath || !pModifiedAt || !A8E_LibraryRepository_ReadInteger(
			A8E_LibraryRepository_FindKey(pObject, pObjectEnd + 1, "size"),
			pObjectEnd + 1, &lValue) || lValue < 0)
		{
			free(pPath);
			free(pModifiedAt);
			return 0;
		}
		if(ppPath) *ppPath = pPath; else free(pPath);
		if(ppModifiedAt) *ppModifiedAt = pModifiedAt; else free(pModifiedAt);
		if(pSize) *pSize = (uint32_t)lValue;
		return 1;
	}
	return 0;
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

static int A8E_LibraryRepository_MakeJsonString(
	char *pText,
	uint32_t lCapacity,
	const char *pValue)
{
	uint32_t lLength = 0;
	if(!pText || !pValue) return 0;
	pText[0] = '\0';
	return A8E_LibraryRepository_AppendJsonString(
		pText, lCapacity, &lLength, pValue);
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

static int A8E_LibraryRepository_InsertManifestObject(
	A8E_LibraryRepository_t *pRepository,
	const char *pArrayKey,
	const char *pObject,
	uint32_t lObjectSize)
{
	const char *pBegin = (const char *)pRepository->pManifest;
	const char *pEnd = pBegin + pRepository->lManifestSize;
	const char *pArray = A8E_LibraryRepository_FindKey(pBegin, pEnd, pArrayKey);
	const char *pArrayEnd;
	char *pInsertion;
	uint32_t lInsertionSize;
	int bExisting;
	if(pArray && *pArray == '[' && (pArrayEnd = A8E_LibraryRepository_Match(
		pArray, pEnd, '[', ']')))
	{
		const char *pFirst = A8E_LibraryRepository_SkipSpace(pArray + 1, pArrayEnd);
		bExisting = pFirst < pArrayEnd;
		lInsertionSize = lObjectSize + (bExisting ? 1u : 0u);
		pInsertion = (char *)malloc(lInsertionSize);
		if(!pInsertion) return 0;
		if(bExisting) pInsertion[0] = ',';
		memcpy(pInsertion + (bExisting ? 1u : 0u), pObject, lObjectSize);
		bExisting = A8E_LibraryRepository_ReplaceSpan(
			&pRepository->pManifest, &pRepository->lManifestSize,
			(uint32_t)(pArrayEnd - pBegin), (uint32_t)(pArrayEnd - pBegin),
			pInsertion, lInsertionSize);
		free(pInsertion);
		return bExisting;
	}
	{
		const char *pClose = pEnd;
		char sPrefix[64];
		uint32_t lPrefixSize;
		while(pClose > pBegin && isspace((unsigned char)pClose[-1])) pClose--;
		if(pClose <= pBegin || pClose[-1] != '}') return 0;
		lPrefixSize = (uint32_t)snprintf(
			sPrefix, sizeof(sPrefix), ",\"%s\":[", pArrayKey);
		if(lPrefixSize >= sizeof(sPrefix)) return 0;
		lInsertionSize = lPrefixSize + lObjectSize + 2u;
		pInsertion = (char *)malloc(lInsertionSize);
		if(!pInsertion) return 0;
		memcpy(pInsertion, sPrefix, lPrefixSize);
		memcpy(pInsertion + lPrefixSize, pObject, lObjectSize);
		pInsertion[lPrefixSize + lObjectSize] = ']';
		pInsertion[lPrefixSize + lObjectSize + 1u] = '\0';
		bExisting = A8E_LibraryRepository_ReplaceSpan(
			&pRepository->pManifest, &pRepository->lManifestSize,
			(uint32_t)(pClose - pBegin - 1), (uint32_t)(pClose - pBegin - 1),
			pInsertion, lInsertionSize - 1u);
		free(pInsertion);
		return bExisting;
	}
}

static int A8E_LibraryRepository_RemoveManifestSpan(
	A8E_LibraryRepository_t *pRepository,
	uint32_t lObjectStart,
	uint32_t lObjectEnd)
{
	A8E_LibraryRepositoryRecord_t tRecord;
	memset(&tRecord, 0, sizeof(tRecord));
	tRecord.lObjectStart = lObjectStart;
	tRecord.lObjectEnd = lObjectEnd;
	return A8E_LibraryRepository_RemoveManifestObject(pRepository, &tRecord);
}

static int A8E_LibraryRepository_AppendObjectField(
	uint8_t **ppObject,
	uint32_t *pObjectSize,
	const char *pKey,
	const char *pValue)
{
	char sField[1024];
	char *pEnd;
	uint32_t lFieldSize;
	uint32_t lInsert;
	if(!ppObject || !pObjectSize || !pKey || !pValue || *pObjectSize == 0u)
		return 0;
	lFieldSize = (uint32_t)snprintf(sField, sizeof(sField), ",\"%s\":%s", pKey, pValue);
	if(lFieldSize >= sizeof(sField)) return 0;
	pEnd = (char *)*ppObject + *pObjectSize;
	while(pEnd > (char *)*ppObject && isspace((unsigned char)pEnd[-1])) pEnd--;
	if(pEnd <= (char *)*ppObject || pEnd[-1] != '}') return 0;
	lInsert = (uint32_t)(pEnd - (char *)*ppObject - 1);
	return A8E_LibraryRepository_ReplaceSpan(
		ppObject, pObjectSize, lInsert, lInsert, sField, lFieldSize);
}

static int A8E_LibraryRepository_ReplaceOrAppendObjectField(
	uint8_t **ppObject,
	uint32_t *pObjectSize,
	const char *pKey,
	const char *pValue)
{
	const char *pBegin = (const char *)*ppObject;
	const char *pEnd = pBegin + *pObjectSize;
	if(A8E_LibraryRepository_FindKey(pBegin, pEnd, pKey))
		return A8E_LibraryRepository_ReplaceObjectField(
			ppObject, pObjectSize, pKey, pValue);
	return A8E_LibraryRepository_AppendObjectField(
		ppObject, pObjectSize, pKey, pValue);
}

static int A8E_LibraryRepository_RemoveObjectField(
	uint8_t **ppObject,
	uint32_t *pObjectSize,
	const char *pKey)
{
	const char *pBegin;
	const char *pEnd;
	const char *pValue;
	const char *pValueEnd;
	const char *pFieldStart;
	const char *pFieldEnd;
	const char *p;
	char sNeedle[64];
	int lNeedleSize;
	if(!ppObject || !pObjectSize || !pKey) return 0;
	pBegin = (const char *)*ppObject;
	pEnd = pBegin + *pObjectSize;
	pValue = A8E_LibraryRepository_FindKey(pBegin, pEnd, pKey);
	if(!pValue) return 1;
	pValueEnd = A8E_LibraryRepository_ValueEnd(pValue, pEnd);
	if(!pValueEnd) return 0;
	lNeedleSize = snprintf(sNeedle, sizeof(sNeedle), "\"%s\"", pKey);
	if(lNeedleSize <= 0 || (size_t)lNeedleSize >= sizeof(sNeedle)) return 0;
	pFieldStart = NULL;
	for(p = pBegin; p + lNeedleSize <= pValue; p++)
		if(memcmp(p, sNeedle, (size_t)lNeedleSize) == 0)
		{
			const char *pCandidate = A8E_LibraryRepository_FindKey(
				p, pValue + 1, pKey);
			if(pCandidate == pValue)
			{
				pFieldStart = p;
				break;
			}
		}
	if(!pFieldStart) return 0;
	pFieldEnd = pValueEnd;
	while(pFieldEnd < pEnd && isspace((unsigned char)*pFieldEnd)) pFieldEnd++;
	if(pFieldEnd < pEnd && *pFieldEnd == ',') pFieldEnd++;
	else
	{
		p = pFieldStart;
		while(p > pBegin && isspace((unsigned char)p[-1])) p--;
		if(p > pBegin && p[-1] == ',') pFieldStart = p - 1;
	}
	return A8E_LibraryRepository_ReplaceSpan(
		ppObject, pObjectSize,
		(uint32_t)(pFieldStart - pBegin), (uint32_t)(pFieldEnd - pBegin), "", 0u);
}

static int A8E_LibraryRepository_BuildTrashRecordJson(
	const A8E_LibraryRepository_t *pRepository,
	const A8E_LibraryRepositoryRecord_t *pRecord,
	char **ppJson,
	uint32_t *pJsonSize)
{
	char sTime[48];
	char sQuotedTime[96];
	uint8_t *pObject;
	uint32_t lObjectSize;
	time_t lNow;
	struct tm *pUtc;
	if(!pRepository || !pRecord || !ppJson || !pJsonSize ||
		pRecord->lObjectEnd < pRecord->lObjectStart ||
		pRecord->lObjectEnd >= pRepository->lManifestSize) return 0;
	lObjectSize = pRecord->lObjectEnd - pRecord->lObjectStart + 1u;
	pObject = (uint8_t *)malloc(lObjectSize);
	if(!pObject) return 0;
	memcpy(pObject, pRepository->pManifest + pRecord->lObjectStart, lObjectSize);
	lNow = time(NULL);
	pUtc = gmtime(&lNow);
	if(!pUtc || strftime(sTime, sizeof(sTime), "%Y-%m-%dT%H:%M:%SZ", pUtc) == 0 ||
		!A8E_LibraryRepository_MakeJsonString(
			sQuotedTime, sizeof(sQuotedTime), sTime) ||
		!A8E_LibraryRepository_ReplaceOrAppendObjectField(
			&pObject, &lObjectSize, "deletedAt", sQuotedTime))
	{
		free(pObject);
		return 0;
	}
	*ppJson = (char *)pObject;
	*pJsonSize = lObjectSize;
	return 1;
}

static A8E_LibraryRepositoryFolder_t *A8E_LibraryRepository_FindFolder(
	A8E_LibraryRepository_t *pRepository,
	const char *pFolderId,
	uint16_t *pIndex)
{
	uint16_t i;
	const char *pId = pFolderId && pFolderId[0] ? pFolderId : "root";
	if(!pRepository) return NULL;
	for(i = 0; i < pRepository->sFolderCount; i++)
		if(strcmp(pRepository->pFolders[i].pId, pId) == 0)
		{
			if(pIndex) *pIndex = i;
			return &pRepository->pFolders[i];
		}
	if(strcmp(pId, "root") == 0 && pIndex) *pIndex = 0xffffu;
	return NULL;
}

static int A8E_LibraryRepository_IsFolderNameValid(const char *pName)
{
	return pName && pName[0] && strlen(pName) <= 256u &&
		strcmp(pName, ".") != 0 && strcmp(pName, "..") != 0 &&
		!strchr(pName, '/') && !strchr(pName, '\\');
}

static int A8E_LibraryRepository_HasSiblingFolder(
	const A8E_LibraryRepository_t *pRepository,
	const char *pParentId,
	const char *pName,
	const char *pExcludeId)
{
	uint16_t i;
	const char *pParent = pParentId && pParentId[0] ? pParentId : "root";
	for(i = 0; i < pRepository->sFolderCount; i++)
	{
		const A8E_LibraryRepositoryFolder_t *pFolder = &pRepository->pFolders[i];
		if(pExcludeId && strcmp(pExcludeId, pFolder->pId) == 0) continue;
		if(strcmp(pFolder->pParentId ? pFolder->pParentId : "root", pParent) == 0)
		{
			const unsigned char *pLeft = (const unsigned char *)pFolder->pName;
			const unsigned char *pRight = (const unsigned char *)pName;
			while(*pLeft && *pRight && tolower(*pLeft) == tolower(*pRight))
			{
				pLeft++;
				pRight++;
			}
			if(*pLeft == *pRight) return 1;
		}
	}
	return 0;
}

static int A8E_LibraryRepository_CommitStaged(
	A8E_LibraryRepository_t *pRepository,
	A8E_LibraryRepository_t *pStaged,
	const char *pRootPath,
	char *pError,
	uint32_t lErrorSize)
{
	int bResult = A8E_LibraryRepository_SaveDirectory(
		pStaged, pRootPath, pError, lErrorSize) &&
		A8E_LibraryRepository_LoadDirectory(
			pRepository, pRootPath, pError, lErrorSize);
	A8E_LibraryRepository_Free(pStaged);
	return bResult;
}

static int A8E_LibraryRepository_BuildFolderJson(
	const char *pId,
	const char *pParentId,
	const char *pName,
	char **ppJson,
	uint32_t *pJsonSize)
{
	char *pJson = (char *)malloc(2048u);
	char sTime[48];
	time_t lNow;
	struct tm *pUtc;
	uint32_t lLength = 0;
	if(!pJson) return 0;
	lNow = time(NULL);
	pUtc = gmtime(&lNow);
	if(!pUtc || strftime(sTime, sizeof(sTime), "%Y-%m-%dT%H:%M:%SZ", pUtc) == 0)
	{
		free(pJson);
		return 0;
	}
	pJson[0] = '\0';
	if(!A8E_LibraryRepository_AppendJsonLiteral(pJson, 2048u, &lLength, "{\"id\":") ||
		!A8E_LibraryRepository_AppendJsonString(pJson, 2048u, &lLength, pId) ||
		!A8E_LibraryRepository_AppendJsonLiteral(pJson, 2048u, &lLength, ",\"name\":") ||
		!A8E_LibraryRepository_AppendJsonString(pJson, 2048u, &lLength, pName) ||
		!A8E_LibraryRepository_AppendJsonLiteral(pJson, 2048u, &lLength, ",\"parentId\":") ||
		(pParentId ? !A8E_LibraryRepository_AppendJsonString(pJson, 2048u, &lLength, pParentId) :
			!A8E_LibraryRepository_AppendJsonLiteral(pJson, 2048u, &lLength, "null")) ||
		!A8E_LibraryRepository_AppendJsonLiteral(pJson, 2048u, &lLength, ",\"createdAt\":") ||
		!A8E_LibraryRepository_AppendJsonString(pJson, 2048u, &lLength, sTime) ||
		!A8E_LibraryRepository_AppendJsonLiteral(pJson, 2048u, &lLength, ",\"modifiedAt\":") ||
		!A8E_LibraryRepository_AppendJsonString(pJson, 2048u, &lLength, sTime) ||
		!A8E_LibraryRepository_AppendJsonLiteral(pJson, 2048u, &lLength, "}"))
	{
		free(pJson);
		return 0;
	}
	*ppJson = pJson;
	*pJsonSize = lLength;
	return 1;
}

static int A8E_LibraryRepository_InsertFolderJson(
	A8E_LibraryRepository_t *pRepository,
	const char *pFolderJson,
	uint32_t lFolderJsonSize)
{
	const char *pBegin = (const char *)pRepository->pManifest;
	const char *pEnd = pBegin + pRepository->lManifestSize;
	const char *pArray = A8E_LibraryRepository_FindKey(pBegin, pEnd, "folders");
	const char *pArrayEnd;
	char *pInsertion;
	uint32_t lInsertionSize;
	int bExisting;
	if(pArray && *pArray == '[' && (pArrayEnd = A8E_LibraryRepository_Match(
		pArray, pEnd, '[', ']')))
	{
		const char *pFirst = A8E_LibraryRepository_SkipSpace(pArray + 1, pArrayEnd);
		bExisting = pFirst < pArrayEnd;
		lInsertionSize = lFolderJsonSize + (bExisting ? 1u : 0u);
		pInsertion = (char *)malloc(lInsertionSize);
		if(!pInsertion) return 0;
		if(bExisting) pInsertion[0] = ',';
		memcpy(pInsertion + (bExisting ? 1u : 0u), pFolderJson, lFolderJsonSize);
		bExisting = A8E_LibraryRepository_ReplaceSpan(
			&pRepository->pManifest, &pRepository->lManifestSize,
			(uint32_t)(pArrayEnd - pBegin), (uint32_t)(pArrayEnd - pBegin),
			pInsertion, lInsertionSize);
		free(pInsertion);
		return bExisting;
	}
	/* Older schema-v1 manifests may omit folders. Add a root record so the
	 * native editor can persist the same folder model as jsA8E. */
	{
		char *pRootJson = NULL;
		uint32_t lRootJsonSize = 0;
		uint32_t lPrefixSize;
		if(!A8E_LibraryRepository_BuildFolderJson(
			"root", NULL, "Library", &pRootJson, &lRootJsonSize)) return 0;
		lPrefixSize = lRootJsonSize + lFolderJsonSize + 24u;
		pInsertion = (char *)malloc(lPrefixSize);
		if(!pInsertion)
		{
			free(pRootJson);
			return 0;
		}
		lInsertionSize = 0;
		A8E_LibraryRepository_AppendJsonLiteral(
			pInsertion, lPrefixSize, &lInsertionSize, "\"folders\":[");
		memcpy(pInsertion + lInsertionSize, pRootJson, lRootJsonSize);
		lInsertionSize += lRootJsonSize;
		pInsertion[lInsertionSize++] = ',';
		memcpy(pInsertion + lInsertionSize, pFolderJson, lFolderJsonSize);
		lInsertionSize += lFolderJsonSize;
		pInsertion[lInsertionSize++] = ']';
		pInsertion[lInsertionSize++] = ',';
		pInsertion[lInsertionSize] = '\0';
		free(pRootJson);
		pBegin = (const char *)pRepository->pManifest;
		while(*pBegin && isspace((unsigned char)*pBegin)) pBegin++;
		if(*pBegin != '{')
		{
			free(pInsertion);
			return 0;
		}
		bExisting = A8E_LibraryRepository_ReplaceSpan(
			&pRepository->pManifest, &pRepository->lManifestSize,
			(uint32_t)(pBegin - (const char *)pRepository->pManifest + 1u),
			(uint32_t)(pBegin - (const char *)pRepository->pManifest + 1u),
			pInsertion, lInsertionSize);
		free(pInsertion);
		return bExisting;
	}
}

static int A8E_LibraryRepository_ReplaceObjectFieldInManifest(
	A8E_LibraryRepository_t *pRepository,
	uint32_t lObjectStart,
	uint32_t lObjectEnd,
	const char *pKey,
	const char *pValue)
{
	uint8_t *pObject;
	uint32_t lObjectSize;
	const char *pBegin = (const char *)pRepository->pManifest;
	if(lObjectEnd < lObjectStart || lObjectEnd >= pRepository->lManifestSize) return 0;
	lObjectSize = lObjectEnd - lObjectStart + 1u;
	pObject = (uint8_t *)malloc(lObjectSize);
	if(!pObject) return 0;
	memcpy(pObject, pBegin + lObjectStart, lObjectSize);
	if(!A8E_LibraryRepository_ReplaceOrAppendObjectField(
		&pObject, &lObjectSize, pKey, pValue) ||
		!A8E_LibraryRepository_ReplaceSpan(
			&pRepository->pManifest, &pRepository->lManifestSize,
			lObjectStart, lObjectEnd + 1u, (const char *)pObject, lObjectSize))
	{
		free(pObject);
		return 0;
	}
	free(pObject);
	return 1;
}

static int A8E_LibraryRepository_HasEntryName(
	const A8E_LibraryRepository_t *pRepository,
	const char *pFolderId,
	const char *pName,
	const char *pExcludeId)
{
	uint16_t i;
	const char *pFolder = pFolderId && pFolderId[0] ? pFolderId : "root";
	for(i = 0; i < pRepository->sRecordCount; i++)
	{
		const A8E_LibraryRepositoryRecord_t *pRecord = &pRepository->pRecords[i];
		if(pExcludeId && strcmp(pExcludeId, pRecord->pId) == 0) continue;
		if(strcmp(pRecord->pFolderId ? pRecord->pFolderId : "root", pFolder) != 0) continue;
		{
			const unsigned char *pLeft = (const unsigned char *)pRecord->pName;
			const unsigned char *pRight = (const unsigned char *)pName;
			while(*pLeft && *pRight && tolower(*pLeft) == tolower(*pRight))
			{
				pLeft++;
				pRight++;
			}
			if(*pLeft == *pRight) return 1;
		}
	}
	return 0;
}

static int A8E_LibraryRepository_NamesEqual(
	const char *pLeft,
	const char *pRight)
{
	if(!pLeft || !pRight) return 0;
	while(*pLeft && *pRight)
	{
		if(tolower((unsigned char)*pLeft++) !=
			tolower((unsigned char)*pRight++)) return 0;
	}
	return *pLeft == '\0' && *pRight == '\0';
}

static int A8E_LibraryRepository_InitializeEmpty(
	A8E_LibraryRepository_t *pRepository,
	char *pError,
	uint32_t lErrorSize)
{
	char sTime[48];
	time_t lNow;
	struct tm *pUtc;
	uint32_t lVersion;
	if(!pRepository) return 0;
	lNow = time(NULL);
	pUtc = gmtime(&lNow);
	if(!pUtc || strftime(sTime, sizeof(sTime), "%Y-%m-%dT%H:%M:%SZ", pUtc) == 0)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot create library timestamp");
		return 0;
	}
	pRepository->pManifest = (uint8_t *)malloc(512u);
	if(!pRepository->pManifest)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
		return 0;
	}
	pRepository->lManifestSize = (uint32_t)snprintf(
		(char *)pRepository->pManifest, 512u,
		"{\"format\":\"a8e-library-export\",\"schemaVersion\":1,"
		"\"libraryVersion\":1,\"createdAt\":\"%s\",\"library\":[]}", sTime);
	pRepository->lLibraryVersion = 1u;
	if(pRepository->lManifestSize >= 512u ||
		!A8E_LibraryPackage_ValidateManifest(
			pRepository->pManifest, pRepository->lManifestSize, &lVersion,
			pError, lErrorSize) ||
		!A8E_LibraryRepository_ParseManifest(pRepository, pError, lErrorSize) ||
		!A8E_LibraryRepository_ParseFolders(pRepository, pError, lErrorSize))
	{
		A8E_LibraryRepository_Free(pRepository);
		if(!pError || !pError[0]) A8E_LibraryRepository_SetError(
			pError, lErrorSize, "cannot initialize library");
		return 0;
	}
	return 1;
}

static int A8E_LibraryRepository_LoadOrCreateEmpty(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	char *pError,
	uint32_t lErrorSize)
{
	char sManifestPath[A8E_REPOSITORY_MAX_PATH];
	FILE *pFile;
	if(A8E_LibraryRepository_LoadDirectory(
		pRepository, pRootPath, pError, lErrorSize)) return 1;
	if(!A8E_LibraryRepository_JoinPath(
		sManifestPath, sizeof(sManifestPath), pRootPath, "library.json")) return 0;
	pFile = fopen(sManifestPath, "rb");
	if(pFile)
	{
		fclose(pFile);
		return 0;
	}
	if(pError && lErrorSize > 0) pError[0] = '\0';
	A8E_LibraryRepository_Free(pRepository);
	A8E_LibraryRepository_Init(pRepository);
	return A8E_LibraryRepository_InitializeEmpty(pRepository, pError, lErrorSize);
}

int A8E_LibraryRepository_ImportImageFile(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pFolderId,
	const char *pSourcePath,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tStaged;
	uint8_t *pBytes = NULL;
	uint32_t lSize = 0;
	const char *pName;
	const char *pCursor;
	const char *pDot;
	const char *pFolder;
	const char *pType;
	char aHash[65];
	char sPath[80];
	char sId[100];
	char sTime[48];
	char *pRecordJson = NULL;
	char sFolder[520];
	uint32_t lRecordSize = 0;
	uint32_t i;
	int bOk;

	if(!pRepository || !pRootPath || !pSourcePath || !pSourcePath[0])
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid image import");
		return 0;
	}
	A8E_LibraryRepository_Init(&tStaged);
	if(!A8E_LibraryRepository_LoadOrCreateEmpty(
		&tStaged, pRootPath, pError, lErrorSize))
	{
		A8E_LibraryRepository_Free(&tStaged);
		return 0;
	}
	pName = pSourcePath;
	for(pCursor = pSourcePath; *pCursor; pCursor++)
		if(*pCursor == '/' || *pCursor == '\\') pName = pCursor + 1;
	if(!pName[0] || strlen(pName) > 256u ||
		!A8E_LibraryRepository_IsFolderNameValid(pName))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid image name");
		return 0;
	}
	pDot = strrchr(pName, '.');
	if(!pDot || strlen(pDot) != 4u ||
		(tolower((unsigned char)pDot[1]) != 'a' &&
		tolower((unsigned char)pDot[1]) != 'x') ||
		tolower((unsigned char)pDot[2]) != 't' ||
		(tolower((unsigned char)pDot[3]) != 'r' &&
		tolower((unsigned char)pDot[3]) != 'e'))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "only ATR and XEX files are supported");
		return 0;
	}
	pType = tolower((unsigned char)pDot[1]) == 'a' ? "atr" : "xex";
	pFolder = pFolderId && pFolderId[0] ? pFolderId : "root";
	if(strcmp(pFolder, "root") != 0 &&
		!A8E_LibraryRepository_FindFolder(&tStaged, pFolder, NULL))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "target folder not found");
		return 0;
	}
	if(A8E_LibraryRepository_HasEntryName(&tStaged, pFolder, pName, NULL))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "entry name already exists");
		return 0;
	}
	if(!A8E_LibraryRepository_ReadFile(
		pSourcePath, &pBytes, &lSize, pError, lErrorSize) || lSize == 0u)
	{
		free(pBytes);
		A8E_LibraryRepository_Free(&tStaged);
		if(!pError || !pError[0]) A8E_LibraryRepository_SetError(
			pError, lErrorSize, "image file is empty");
		return 0;
	}
	A8E_LibraryPackage_Sha256Hex(pBytes, lSize, aHash);
	snprintf(sPath, sizeof(sPath), "blobs/%s.%s", aHash, pType);
	for(i = 1u; i < 100000u; i++)
	{
		snprintf(sId, sizeof(sId), "native-drop-%u-%u", tStaged.lLibraryVersion, i);
		if(!A8E_LibraryRepository_FindRecord(&tStaged, sId, NULL)) break;
	}
	if(i == 100000u || !A8E_LibraryRepository_MakeJsonString(
		sFolder, sizeof(sFolder), pFolder))
	{
		free(pBytes);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot create image identity");
		return 0;
	}
	{
		time_t lNow = time(NULL);
		struct tm *pUtc = gmtime(&lNow);
		if(!pUtc || strftime(sTime, sizeof(sTime), "%Y-%m-%dT%H:%M:%SZ", pUtc) == 0)
		{
			free(pBytes);
			A8E_LibraryRepository_Free(&tStaged);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot create image timestamp");
			return 0;
		}
	}
	pRecordJson = (char *)malloc(4096u);
	if(!pRecordJson)
	{
		free(pBytes);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
		return 0;
	}
	pRecordJson[0] = '\0';
	bOk = A8E_LibraryRepository_AppendJsonLiteral(
		pRecordJson, 4096u, &lRecordSize, "{\"id\":") &&
		A8E_LibraryRepository_AppendJsonString(
			pRecordJson, 4096u, &lRecordSize, sId) &&
		A8E_LibraryRepository_AppendJsonLiteral(
			pRecordJson, 4096u, &lRecordSize, ",\"name\":") &&
		A8E_LibraryRepository_AppendJsonString(
			pRecordJson, 4096u, &lRecordSize, pName) &&
		A8E_LibraryRepository_AppendJsonLiteral(
			pRecordJson, 4096u, &lRecordSize, pType[0] == 'a' ? ",\"type\":\"atr\",\"path\":" : ",\"type\":\"xex\",\"path\":") &&
		A8E_LibraryRepository_AppendJsonString(
			pRecordJson, 4096u, &lRecordSize, sPath);
	{
		char sSize[32];
		snprintf(sSize, sizeof(sSize), "%u", lSize);
		bOk = bOk &&
			A8E_LibraryRepository_AppendJsonLiteral(
				pRecordJson, 4096u, &lRecordSize, ",\"size\":") &&
			A8E_LibraryRepository_AppendJsonLiteral(
				pRecordJson, 4096u, &lRecordSize, sSize);
	}
	bOk = bOk &&
		A8E_LibraryRepository_AppendJsonLiteral(
			pRecordJson, 4096u, &lRecordSize, ",\"sha256\":") &&
		A8E_LibraryRepository_AppendJsonString(
			pRecordJson, 4096u, &lRecordSize, aHash) &&
		A8E_LibraryRepository_AppendJsonLiteral(
			pRecordJson, 4096u, &lRecordSize, ",\"createdAt\":") &&
		A8E_LibraryRepository_AppendJsonString(
			pRecordJson, 4096u, &lRecordSize, sTime) &&
		A8E_LibraryRepository_AppendJsonLiteral(
			pRecordJson, 4096u, &lRecordSize, ",\"modifiedAt\":") &&
		A8E_LibraryRepository_AppendJsonString(
			pRecordJson, 4096u, &lRecordSize, sTime) &&
		A8E_LibraryRepository_AppendJsonLiteral(
			pRecordJson, 4096u, &lRecordSize, ",\"mountedSlot\":-1,\"folderId\":") &&
		A8E_LibraryRepository_AppendJsonString(
			pRecordJson, 4096u, &lRecordSize, pFolder) &&
		A8E_LibraryRepository_AppendJsonLiteral(
			pRecordJson, 4096u, &lRecordSize, "}");
	if(!bOk || !A8E_LibraryRepository_InsertManifestObject(
		&tStaged, "library", pRecordJson, lRecordSize) ||
		!A8E_LibraryRepository_AddPayload(&tStaged, sPath, pBytes, lSize) ||
		!A8E_LibraryRepository_IncrementVersion(&tStaged))
	{
		free(pRecordJson);
		free(pBytes);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot import image file");
		return 0;
	}
	free(pRecordJson);
	free(pBytes);
	return A8E_LibraryRepository_CommitStaged(
		pRepository, &tStaged, pRootPath, pError, lErrorSize);
}

int A8E_LibraryRepository_EnsureDirectory(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tStaged;
	if(!pRepository || !pRootPath)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid library directory");
		return 0;
	}
	if(pRepository->pManifest && pRepository->lManifestSize > 0u) return 1;
	A8E_LibraryRepository_Init(&tStaged);
	if(!A8E_LibraryRepository_LoadOrCreateEmpty(
		&tStaged, pRootPath, pError, lErrorSize) ||
		!A8E_LibraryRepository_SaveDirectory(
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

int A8E_LibraryRepository_CreateFolder(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pParentId,
	const char *pName,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tStaged;
	const char *pParent = pParentId && pParentId[0] ? pParentId : "root";
	char sId[80];
	char *pFolderJson = NULL;
	uint32_t lFolderJsonSize = 0;
	uint32_t i;
	if(!pRepository || !pRootPath || !A8E_LibraryRepository_IsFolderNameValid(pName))
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid folder name");
		return 0;
	}
	if(strcmp(pParent, "root") != 0 &&
		!A8E_LibraryRepository_FindFolder(pRepository, pParent, NULL))
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "parent folder not found");
		return 0;
	}
	if(A8E_LibraryRepository_HasSiblingFolder(pRepository, pParent, pName, NULL))
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "folder already exists");
		return 0;
	}
	for(i = 1u; i < 100000u; i++)
	{
		snprintf(sId, sizeof(sId), "native-folder-%u-%u", pRepository->lLibraryVersion, i);
		if(!A8E_LibraryRepository_FindFolder(pRepository, sId, NULL)) break;
	}
	if(i == 100000u || !A8E_LibraryRepository_BuildFolderJson(
		sId, pParent, pName, &pFolderJson, &lFolderJsonSize))
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot create folder");
		return 0;
	}
	A8E_LibraryRepository_Init(&tStaged);
	if(!A8E_LibraryRepository_LoadDirectory(&tStaged, pRootPath, pError, lErrorSize) ||
		!A8E_LibraryRepository_InsertFolderJson(&tStaged, pFolderJson, lFolderJsonSize) ||
		!A8E_LibraryRepository_IncrementVersion(&tStaged))
	{
		free(pFolderJson);
		A8E_LibraryRepository_Free(&tStaged);
		if(!pError || !pError[0]) A8E_LibraryRepository_SetError(
			pError, lErrorSize, "cannot create folder");
		return 0;
	}
	free(pFolderJson);
	return A8E_LibraryRepository_CommitStaged(
		pRepository, &tStaged, pRootPath, pError, lErrorSize);
}

int A8E_LibraryRepository_RenameFolder(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pFolderId,
	const char *pName,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tStaged;
	A8E_LibraryRepositoryFolder_t *pFolder;
	char sName[520];
	if(!pRepository || !pRootPath || !pFolderId || strcmp(pFolderId, "root") == 0 ||
		!A8E_LibraryRepository_IsFolderNameValid(pName))
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid folder rename");
		return 0;
	}
	A8E_LibraryRepository_Init(&tStaged);
	if(!A8E_LibraryRepository_LoadDirectory(&tStaged, pRootPath, pError, lErrorSize) ||
		!(pFolder = A8E_LibraryRepository_FindFolder(&tStaged, pFolderId, NULL)))
	{
		A8E_LibraryRepository_Free(&tStaged);
		if(!pError || !pError[0]) A8E_LibraryRepository_SetError(
			pError, lErrorSize, "folder not found");
		return 0;
	}
	if(A8E_LibraryRepository_HasSiblingFolder(
		&tStaged, pFolder->pParentId, pName, pFolder->pId))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "folder already exists");
		return 0;
	}
	if(!A8E_LibraryRepository_MakeJsonString(sName, sizeof(sName), pName))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid folder name");
		return 0;
	}
	if(!A8E_LibraryRepository_ReplaceObjectFieldInManifest(
		&tStaged, pFolder->lObjectStart, pFolder->lObjectEnd, "name", sName) ||
		!A8E_LibraryRepository_IncrementVersion(&tStaged))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot rename folder");
		return 0;
	}
	return A8E_LibraryRepository_CommitStaged(
		pRepository, &tStaged, pRootPath, pError, lErrorSize);
}

int A8E_LibraryRepository_DeleteFolder(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pFolderId,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tStaged;
	A8E_LibraryRepositoryFolder_t *pFolder;
	uint16_t i;
	if(!pRepository || !pRootPath || !pFolderId || strcmp(pFolderId, "root") == 0)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "folder cannot be deleted");
		return 0;
	}
	A8E_LibraryRepository_Init(&tStaged);
	if(!A8E_LibraryRepository_LoadDirectory(&tStaged, pRootPath, pError, lErrorSize) ||
		!(pFolder = A8E_LibraryRepository_FindFolder(&tStaged, pFolderId, NULL)))
	{
		A8E_LibraryRepository_Free(&tStaged);
		if(!pError || !pError[0]) A8E_LibraryRepository_SetError(
			pError, lErrorSize, "folder not found");
		return 0;
	}
	for(i = 0; i < tStaged.sFolderCount; i++)
		if(tStaged.pFolders[i].pParentId &&
			strcmp(tStaged.pFolders[i].pParentId, pFolderId) == 0)
		{
			A8E_LibraryRepository_Free(&tStaged);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "folder is not empty");
			return 0;
		}
	for(i = 0; i < tStaged.sRecordCount; i++)
		if(tStaged.pRecords[i].pFolderId &&
			strcmp(tStaged.pRecords[i].pFolderId, pFolderId) == 0)
		{
			A8E_LibraryRepository_Free(&tStaged);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "folder is not empty");
			return 0;
		}
	if(!A8E_LibraryRepository_RemoveManifestSpan(
		&tStaged, pFolder->lObjectStart, pFolder->lObjectEnd) ||
		!A8E_LibraryRepository_IncrementVersion(&tStaged))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot delete folder");
		return 0;
	}
	return A8E_LibraryRepository_CommitStaged(
		pRepository, &tStaged, pRootPath, pError, lErrorSize);
}

int A8E_LibraryRepository_MoveEntry(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pEntryId,
	const char *pFolderId,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tStaged;
	A8E_LibraryRepositoryRecord_t *pRecord;
	const char *pFolder = pFolderId && pFolderId[0] ? pFolderId : "root";
	char sFolder[520];
	if(!pRepository || !pRootPath || !pEntryId ||
		(strcmp(pFolder, "root") != 0 && !A8E_LibraryRepository_FindFolder(
			pRepository, pFolder, NULL)))
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "target folder not found");
		return 0;
	}
	A8E_LibraryRepository_Init(&tStaged);
	if(!A8E_LibraryRepository_LoadDirectory(&tStaged, pRootPath, pError, lErrorSize) ||
		!(pRecord = A8E_LibraryRepository_FindRecord(&tStaged, pEntryId, NULL)))
	{
		A8E_LibraryRepository_Free(&tStaged);
		if(!pError || !pError[0]) A8E_LibraryRepository_SetError(
			pError, lErrorSize, "library entry not found");
		return 0;
	}
	if(A8E_LibraryRepository_HasEntryName(
		&tStaged, pFolder, pRecord->pName, pRecord->pId))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "entry name already exists");
		return 0;
	}
	if(!A8E_LibraryRepository_MakeJsonString(sFolder, sizeof(sFolder), pFolder))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid folder id");
		return 0;
	}
	if(!A8E_LibraryRepository_ReplaceObjectFieldInManifest(
		&tStaged, pRecord->lObjectStart, pRecord->lObjectEnd, "folderId", sFolder) ||
		!A8E_LibraryRepository_IncrementVersion(&tStaged))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot move library entry");
		return 0;
	}
	return A8E_LibraryRepository_CommitStaged(
		pRepository, &tStaged, pRootPath, pError, lErrorSize);
}

int A8E_LibraryRepository_RenameEntry(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pEntryId,
	const char *pName,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tStaged;
	A8E_LibraryRepositoryRecord_t *pRecord;
	char sName[520];
	if(!pRepository || !pRootPath || !pEntryId ||
		!A8E_LibraryRepository_IsFolderNameValid(pName))
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid entry name");
		return 0;
	}
	A8E_LibraryRepository_Init(&tStaged);
	if(!A8E_LibraryRepository_LoadDirectory(&tStaged, pRootPath, pError, lErrorSize) ||
		!(pRecord = A8E_LibraryRepository_FindRecord(&tStaged, pEntryId, NULL)))
	{
		A8E_LibraryRepository_Free(&tStaged);
		if(!pError || !pError[0]) A8E_LibraryRepository_SetError(
			pError, lErrorSize, "library entry not found");
		return 0;
	}
	if(A8E_LibraryRepository_HasEntryName(
		&tStaged, pRecord->pFolderId, pName, pRecord->pId))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "entry name already exists");
		return 0;
	}
	if(!A8E_LibraryRepository_MakeJsonString(sName, sizeof(sName), pName))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid entry name");
		return 0;
	}
	if(!A8E_LibraryRepository_ReplaceObjectFieldInManifest(
		&tStaged, pRecord->lObjectStart, pRecord->lObjectEnd, "name", sName) ||
		!A8E_LibraryRepository_IncrementVersion(&tStaged))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot rename library entry");
		return 0;
	}
	return A8E_LibraryRepository_CommitStaged(
		pRepository, &tStaged, pRootPath, pError, lErrorSize);
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
	const uint8_t *pOldBytes;
	uint32_t lOldSize = 0;
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
	pOldBytes = pOldPath ? A8E_LibraryRepository_GetPayload(
		&tStaged, pOldPath, &lOldSize) : NULL;
	if(!pOldPath || !pOldType || !pOldBytes || !A8E_LibraryRepository_AddPayload(&tStaged, sPath, pBytes, lSize) ||
		!A8E_LibraryRepository_ReplaceRecordFields(
			&tStaged, pRecord, pType, sPath, lSize, aHash) ||
		(strcmp(pOldPath, sPath) == 0 || A8E_LibraryRepository_AppendRevision(
			&tStaged, pRecord, pOldPath, lOldSize, pOldBytes)) == 0 ||
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
	char *pTrashJson = NULL;
	uint32_t lTrashJsonSize = 0;
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
	if(!A8E_LibraryRepository_BuildTrashRecordJson(
		&tStaged, pRecord, &pTrashJson, &lTrashJsonSize) ||
		!A8E_LibraryRepository_RemoveManifestObject(&tStaged, pRecord) ||
		!A8E_LibraryRepository_InsertManifestObject(
			&tStaged, "trash", pTrashJson, lTrashJsonSize))
	{
		free(pTrashJson);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot move library entry to trash");
		return 0;
	}
	free(pTrashJson);
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
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot update workspace");
		return 0;
	}
	free(pWorkspaceJson);
	if(!A8E_LibraryRepository_IncrementVersion(&tStaged))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot remove library entry");
		return 0;
	}
	A8E_LibraryRepository_FreeRecordFields(pRecord);
	if(sRecordIndex + 1u < tStaged.sRecordCount)
		memmove(&tStaged.pRecords[sRecordIndex], &tStaged.pRecords[sRecordIndex + 1u],
			(size_t)(tStaged.sRecordCount - sRecordIndex - 1u) * sizeof(*tStaged.pRecords));
	tStaged.sRecordCount--;
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

int A8E_LibraryRepository_RestoreTrashEntry(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pEntryId,
	const char *pFolderId,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tStaged;
	A8E_LibraryRepositoryRecord_t *pTrash;
	uint8_t *pObject = NULL;
	uint32_t lObjectSize;
	char sFolder[520];
	const char *pFolder;

	if(!pRepository || !pRootPath || !pEntryId)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid trash entry");
		return 0;
	}
	A8E_LibraryRepository_Init(&tStaged);
	if(!A8E_LibraryRepository_LoadDirectory(&tStaged, pRootPath, pError, lErrorSize) ||
		!(pTrash = A8E_LibraryRepository_FindTrashRecord(&tStaged, pEntryId, NULL)))
	{
		A8E_LibraryRepository_Free(&tStaged);
		if(!pError || !pError[0]) A8E_LibraryRepository_SetError(
			pError, lErrorSize, "trash entry not found");
		return 0;
	}
	pFolder = pFolderId && pFolderId[0] ? pFolderId : pTrash->pFolderId;
	if(!pFolder || !pFolder[0] ||
		(strcmp(pFolder, "root") != 0 &&
			!A8E_LibraryRepository_FindFolder(&tStaged, pFolder, NULL))) pFolder = "root";
	if(A8E_LibraryRepository_HasEntryName(
		&tStaged, pFolder, pTrash->pName, NULL))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "entry name already exists");
		return 0;
	}
	lObjectSize = pTrash->lObjectEnd - pTrash->lObjectStart + 1u;
	pObject = (uint8_t *)malloc(lObjectSize);
	if(!pObject)
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
		return 0;
	}
	memcpy(pObject, tStaged.pManifest + pTrash->lObjectStart, lObjectSize);
	if(!A8E_LibraryRepository_MakeJsonString(sFolder, sizeof(sFolder), pFolder) ||
		!A8E_LibraryRepository_ReplaceOrAppendObjectField(
			&pObject, &lObjectSize, "folderId", sFolder) ||
		!A8E_LibraryRepository_ReplaceOrAppendObjectField(
			&pObject, &lObjectSize, "mountedSlot", "-1") ||
		!A8E_LibraryRepository_RemoveObjectField(
			&pObject, &lObjectSize, "deletedAt") ||
		!A8E_LibraryRepository_RemoveManifestObject(&tStaged, pTrash) ||
		!A8E_LibraryRepository_InsertManifestObject(
			&tStaged, "library", pObject, lObjectSize) ||
		!A8E_LibraryRepository_IncrementVersion(&tStaged))
	{
		free(pObject);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot restore trash entry");
		return 0;
	}
	free(pObject);
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

int A8E_LibraryRepository_PurgeTrashEntry(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pEntryId,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tStaged;
	A8E_LibraryRepositoryRecord_t *pTrash;
	uint16_t sTrashIndex;
	uint16_t sIndex;
	char *pOldPath;

	if(!pRepository || !pRootPath || !pEntryId)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid trash entry");
		return 0;
	}
	A8E_LibraryRepository_Init(&tStaged);
	if(!A8E_LibraryRepository_LoadDirectory(&tStaged, pRootPath, pError, lErrorSize) ||
		!(pTrash = A8E_LibraryRepository_FindTrashRecord(
			&tStaged, pEntryId, &sTrashIndex)))
	{
		A8E_LibraryRepository_Free(&tStaged);
		if(!pError || !pError[0]) A8E_LibraryRepository_SetError(
			pError, lErrorSize, "trash entry not found");
		return 0;
	}
	pOldPath = A8E_LibraryRepository_DuplicateString(pTrash->pPath);
	if(!pOldPath || !A8E_LibraryRepository_RemoveManifestObject(&tStaged, pTrash) ||
		!A8E_LibraryRepository_IncrementVersion(&tStaged))
	{
		free(pOldPath);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot purge trash entry");
		return 0;
	}
	A8E_LibraryRepository_FreeRecordFields(pTrash);
	if(sTrashIndex + 1u < tStaged.sTrashCount)
		memmove(&tStaged.pTrashRecords[sTrashIndex],
			&tStaged.pTrashRecords[sTrashIndex + 1u],
			(size_t)(tStaged.sTrashCount - sTrashIndex - 1u) * sizeof(*tStaged.pTrashRecords));
	tStaged.sTrashCount--;
	for(sIndex = tStaged.sPayloadCount; sIndex > 0u; sIndex--)
	{
		const char *pPayloadPath = tStaged.pPayloads[sIndex - 1u].pName;
		if(!A8E_LibraryRepository_IsPayloadReferenced(&tStaged, pPayloadPath))
			A8E_LibraryRepository_RemovePayload(&tStaged, pPayloadPath);
	}
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

int A8E_LibraryRepository_PurgeTrashBefore(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pBeforeUtc,
	uint16_t *pPurgedCount,
	char *pError,
	uint32_t lErrorSize)
{
	uint16_t sIndex;
	uint16_t sCount = 0;

	if(pPurgedCount) *pPurgedCount = 0;
	if(!pRepository || !pRootPath || !pBeforeUtc || !pBeforeUtc[0])
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize,
			"invalid trash cutoff");
		return 0;
	}
	/* PurgeTrashEntry reloads the repository after every successful removal,
	 * so the index deliberately stays in place when an item is removed. */
	for(sIndex = 0; sIndex < pRepository->sTrashCount; )
	{
		const A8E_LibraryRepositoryRecord_t *pTrash =
			&pRepository->pTrashRecords[sIndex];
		char sEntryId[257];
		if(!pTrash->pDeletedAt || strcmp(pTrash->pDeletedAt, pBeforeUtc) >= 0)
		{
			sIndex++;
			continue;
		}
		strncpy(sEntryId, pTrash->pId, sizeof(sEntryId) - 1u);
		sEntryId[sizeof(sEntryId) - 1u] = '\0';
		if(!A8E_LibraryRepository_PurgeTrashEntry(
			pRepository, pRootPath, sEntryId, pError, lErrorSize))
			return 0;
		sCount++;
	}
	if(pPurgedCount) *pPurgedCount = sCount;
	return 1;
}

int A8E_LibraryRepository_PromoteRevision(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pEntryId,
	const char *pRevisionId,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tStaged;
	A8E_LibraryRepositoryRecord_t *pRecord;
	char *pRevisionPath = NULL;
	char *pRevisionModifiedAt = NULL;
	const uint8_t *pBytes;
	const uint8_t *pCurrentBytes;
	uint32_t lRevisionSize;
	uint32_t lPayloadSize;
	uint32_t lCurrentSize;
	uint8_t *pObject = NULL;
	uint32_t lObjectSize;
	char aHash[65];
	char sQuotedPath[2048];
	char sQuotedModifiedAt[128];
	char sQuotedRevisionId[2048];
	char sQuotedHash[80];
	char sSize[32];
	const char *pHash;
	const char *pDot;
	const char *pType;
	uint32_t i;

	if(!pRepository || !pRootPath || !pEntryId || !pRevisionId || !pRevisionId[0])
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid revision");
		return 0;
	}
	A8E_LibraryRepository_Init(&tStaged);
	if(!A8E_LibraryRepository_LoadDirectory(
		&tStaged, pRootPath, pError, lErrorSize) ||
		!(pRecord = A8E_LibraryRepository_FindRecord(&tStaged, pEntryId, NULL)))
	{
		A8E_LibraryRepository_Free(&tStaged);
		if(!pError || !pError[0]) A8E_LibraryRepository_SetError(
			pError, lErrorSize, "library entry not found");
		return 0;
	}
	if(!A8E_LibraryRepository_FindRevision(
		&tStaged, pRecord, pRevisionId, &pRevisionPath,
		&pRevisionModifiedAt, &lRevisionSize))
	{
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "revision not found");
		return 0;
	}
	pCurrentBytes = A8E_LibraryRepository_GetPayload(
		&tStaged, pRecord->pPath, &lCurrentSize);
	if(!pCurrentBytes || !A8E_LibraryRepository_AppendRevision(
		&tStaged, pRecord, pRecord->pPath, lCurrentSize, pCurrentBytes))
	{
		free(pRevisionPath);
		free(pRevisionModifiedAt);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot retain current revision");
		return 0;
	}
	pBytes = A8E_LibraryRepository_GetPayload(
		&tStaged, pRevisionPath, &lPayloadSize);
	if(!pBytes || lPayloadSize != lRevisionSize ||
		strlen(pRevisionPath) != 74u ||
		strncmp(pRevisionPath, "blobs/", 6u) != 0)
	{
		free(pRevisionPath);
		free(pRevisionModifiedAt);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid revision payload");
		return 0;
	}
	pHash = pRevisionPath + 6u;
	pDot = pHash + 64u;
	if(pDot[0] != '.' || pDot[1] == '\0' || pDot[4] != '\0' ||
		(strcmp(pDot + 1, "atr") != 0 && strcmp(pDot + 1, "xex") != 0))
	{
		free(pRevisionPath);
		free(pRevisionModifiedAt);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid revision payload");
		return 0;
	}
	for(i = 0; i < 64u; i++)
		if(A8E_LibraryRepository_HexDigit(pHash[i]) < 0)
		{
			free(pRevisionPath);
			free(pRevisionModifiedAt);
			A8E_LibraryRepository_Free(&tStaged);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid revision payload");
			return 0;
		}
	A8E_LibraryPackage_Sha256Hex(pBytes, lPayloadSize, aHash);
	if(strncmp(aHash, pHash, 64u) != 0 ||
		!A8E_LibraryRepository_MakeJsonString(
			sQuotedPath, sizeof(sQuotedPath), pRevisionPath) ||
		!A8E_LibraryRepository_MakeJsonString(
			sQuotedModifiedAt, sizeof(sQuotedModifiedAt), pRevisionModifiedAt) ||
		!A8E_LibraryRepository_MakeJsonString(
			sQuotedRevisionId, sizeof(sQuotedRevisionId), pRevisionId) ||
		!A8E_LibraryRepository_MakeJsonString(
			sQuotedHash, sizeof(sQuotedHash), aHash))
	{
		free(pRevisionPath);
		free(pRevisionModifiedAt);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid revision payload");
		return 0;
	}
	pType = pDot + 1;
	snprintf(sSize, sizeof(sSize), "%u", lPayloadSize);
	lObjectSize = pRecord->lObjectEnd - pRecord->lObjectStart + 1u;
	pObject = (uint8_t *)malloc(lObjectSize);
	if(!pObject)
	{
		free(pRevisionPath);
		free(pRevisionModifiedAt);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
		return 0;
	}
	memcpy(pObject, tStaged.pManifest + pRecord->lObjectStart, lObjectSize);
	if(!A8E_LibraryRepository_ReplaceOrAppendObjectField(
		&pObject, &lObjectSize, "type", pType[0] == 'a' ? "\"atr\"" : "\"xex\"") ||
		!A8E_LibraryRepository_ReplaceOrAppendObjectField(
			&pObject, &lObjectSize, "path", sQuotedPath) ||
		!A8E_LibraryRepository_ReplaceOrAppendObjectField(
			&pObject, &lObjectSize, "size", sSize) ||
		!A8E_LibraryRepository_ReplaceOrAppendObjectField(
			&pObject, &lObjectSize, "sha256", sQuotedHash) ||
		!A8E_LibraryRepository_ReplaceOrAppendObjectField(
			&pObject, &lObjectSize, "modifiedAt", sQuotedModifiedAt) ||
		!A8E_LibraryRepository_ReplaceOrAppendObjectField(
			&pObject, &lObjectSize, "preferredRevisionId", sQuotedRevisionId) ||
		!A8E_LibraryRepository_ReplaceSpan(
			&tStaged.pManifest, &tStaged.lManifestSize,
			pRecord->lObjectStart, pRecord->lObjectEnd + 1u,
			(const char *)pObject, lObjectSize) ||
		!A8E_LibraryRepository_IncrementVersion(&tStaged))
	{
		free(pObject);
		free(pRevisionPath);
		free(pRevisionModifiedAt);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot promote revision");
		return 0;
	}
	free(pObject);
	free(pRevisionPath);
	free(pRevisionModifiedAt);
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

typedef struct
{
	char *pSourceId;
	char *pTargetId;
} A8E_LibraryRepository_ImportMap_t;

static int A8E_LibraryRepository_ManifestReferencesPath(
	const uint8_t *pManifest,
	uint32_t lManifestSize,
	const char *pPath);

static int A8E_LibraryRepository_ReportProgress(
	A8E_LibraryProgressCallback pProgress,
	void *pUserData,
	const char *pPhase,
	uint32_t lCompleted,
	uint32_t lTotal,
	const char *pCurrent,
	char *pError,
	uint32_t lErrorSize)
{
	if(!pProgress || pProgress(
		pPhase, lCompleted, lTotal, pCurrent, pUserData)) return 1;
	A8E_LibraryRepository_SetError(
		pError, lErrorSize, "A8E library operation canceled");
	return 0;
}

static const char *A8E_LibraryRepository_FindImportMap(
	const A8E_LibraryRepository_ImportMap_t *pMaps,
	uint16_t sMapCount,
	const char *pSourceId)
{
	uint16_t i;
	if(!pMaps || !pSourceId) return NULL;
	for(i = 0; i < sMapCount; i++)
		if(strcmp(pMaps[i].pSourceId, pSourceId) == 0)
			return pMaps[i].pTargetId;
	return NULL;
}

static int A8E_LibraryRepository_AddImportMap(
	A8E_LibraryRepository_ImportMap_t *pMaps,
	uint16_t *pMapCount,
	uint16_t sMapCapacity,
	const char *pSourceId,
	const char *pTargetId)
{
	if(!pMaps || !pMapCount || *pMapCount >= sMapCapacity ||
		!pSourceId || !pTargetId) return 0;
	pMaps[*pMapCount].pSourceId = A8E_LibraryRepository_DuplicateString(pSourceId);
	pMaps[*pMapCount].pTargetId = A8E_LibraryRepository_DuplicateString(pTargetId);
	if(!pMaps[*pMapCount].pSourceId || !pMaps[*pMapCount].pTargetId)
	{
		free(pMaps[*pMapCount].pSourceId);
		free(pMaps[*pMapCount].pTargetId);
		pMaps[*pMapCount].pSourceId = NULL;
		pMaps[*pMapCount].pTargetId = NULL;
		return 0;
	}
	(*pMapCount)++;
	return 1;
}

static void A8E_LibraryRepository_FreeImportMaps(
	A8E_LibraryRepository_ImportMap_t *pMaps,
	uint16_t sMapCount)
{
	uint16_t i;
	if(!pMaps) return;
	for(i = 0; i < sMapCount; i++)
	{
		free(pMaps[i].pSourceId);
		free(pMaps[i].pTargetId);
	}
	free(pMaps);
}

static int A8E_LibraryRepository_RefreshParsed(
	A8E_LibraryRepository_t *pRepository,
	char *pError,
	uint32_t lErrorSize)
{
	if(!pRepository) return 0;
	A8E_LibraryRepository_FreeRecords(
		pRepository->pRecords, pRepository->sRecordCount);
	A8E_LibraryRepository_FreeRecords(
		pRepository->pTrashRecords, pRepository->sTrashCount);
	A8E_LibraryRepository_FreeFolders(
		pRepository->pFolders, pRepository->sFolderCount);
	pRepository->pRecords = NULL;
	pRepository->sRecordCount = 0;
	pRepository->pTrashRecords = NULL;
	pRepository->sTrashCount = 0;
	pRepository->pFolders = NULL;
	pRepository->sFolderCount = 0;
	memset(pRepository->acDeviceEntryId, 0,
		sizeof(pRepository->acDeviceEntryId));
	memset(pRepository->abDeviceWriteProtected, 0,
		sizeof(pRepository->abDeviceWriteProtected));
	return A8E_LibraryRepository_ParseManifest(
		pRepository, pError, lErrorSize) &&
		A8E_LibraryRepository_ParseFolders(pRepository, pError, lErrorSize) &&
	(A8E_LibraryRepository_ParseWorkspace(pRepository), 1);
}

static A8E_LibraryRepositoryFolder_t *A8E_LibraryRepository_FindFolderByName(
	A8E_LibraryRepository_t *pRepository,
	const char *pParentId,
	const char *pName)
{
	uint16_t i;
	const char *pParent = pParentId && pParentId[0] ? pParentId : "root";
	if(!pRepository || !pName) return NULL;
	for(i = 0; i < pRepository->sFolderCount; i++)
	{
		A8E_LibraryRepositoryFolder_t *pFolder = &pRepository->pFolders[i];
		if(strcmp(pFolder->pParentId ? pFolder->pParentId : "root", pParent) == 0 &&
			A8E_LibraryRepository_NamesEqual(pFolder->pName, pName)) return pFolder;
	}
	return NULL;
}

static int A8E_LibraryRepository_RecordHash(
	const A8E_LibraryRepository_t *pRepository,
	const A8E_LibraryRepositoryRecord_t *pRecord,
	char aHash[65])
{
	const uint8_t *pBytes;
	uint32_t lSize;
	if(!pRepository || !pRecord || !aHash) return 0;
	pBytes = A8E_LibraryRepository_GetPayload(
		pRepository, pRecord->pPath, &lSize);
	if(!pBytes) return 0;
	A8E_LibraryPackage_Sha256Hex(pBytes, lSize, aHash);
	return 1;
}

static int A8E_LibraryRepository_MakeImportedName(
	const A8E_LibraryRepository_t *pRepository,
	const char *pFolderId,
	const char *pName,
	char *pOutput,
	uint32_t lOutputSize)
{
	const char *pDot;
	char sBase[257];
	char sExtension[257];
	uint32_t lBaseSize;
	uint32_t i;
	if(!pRepository || !pName || !pOutput || lOutputSize == 0u) return 0;
	if(!A8E_LibraryRepository_HasEntryName(
		pRepository, pFolderId, pName, NULL))
	{
		if(strlen(pName) >= lOutputSize) return 0;
		strcpy(pOutput, pName);
		return 1;
	}
	pDot = strrchr(pName, '.');
	lBaseSize = pDot && pDot > pName ? (uint32_t)(pDot - pName) : (uint32_t)strlen(pName);
	if(lBaseSize >= sizeof(sBase)) return 0;
	memcpy(sBase, pName, lBaseSize);
	sBase[lBaseSize] = '\0';
	if(pDot)
	{
		if(strlen(pDot) >= sizeof(sExtension)) return 0;
		strcpy(sExtension, pDot);
	}
	else sExtension[0] = '\0';
	for(i = 1u; i < 100000u; i++)
	{
		int lLength = snprintf(pOutput, lOutputSize, "%s(%u)%s",
			sBase, i, sExtension);
		if(lLength < 0 || (uint32_t)lLength >= lOutputSize) return 0;
		if(!A8E_LibraryRepository_HasEntryName(
			pRepository, pFolderId, pOutput, NULL)) return 1;
	}
	return 0;
}

static int A8E_LibraryRepository_RevisionIdExists(
	const char *pObject,
	const char *pObjectEnd,
	const char *pRevisionId)
{
	const char *pArray;
	const char *pArrayEnd;
	const char *p;
	if(!pObject || !pObjectEnd || !pRevisionId) return 0;
	pArray = A8E_LibraryRepository_FindKey(pObject, pObjectEnd, "revisions");
	if(!pArray || *pArray != '[' ||
		!(pArrayEnd = A8E_LibraryRepository_Match(pArray, pObjectEnd, '[', ']'))) return 0;
	for(p = pArray + 1; p < pArrayEnd; p++)
	{
		const char *pRevisionEnd;
		char *pId;
		if(*p != '{') continue;
		pRevisionEnd = A8E_LibraryRepository_Match(p, pArrayEnd + 1, '{', '}');
		if(!pRevisionEnd) return 0;
		pId = A8E_LibraryRepository_ReadString(
			A8E_LibraryRepository_FindKey(p, pRevisionEnd + 1, "id"),
			pRevisionEnd + 1);
		if(!pId) return 0;
		if(strcmp(pId, pRevisionId) == 0)
		{
			free(pId);
			return 1;
		}
		free(pId);
		p = pRevisionEnd;
	}
	return 0;
}

static int A8E_LibraryRepository_MergeRecordRevisions(
	A8E_LibraryRepository_t *pMerged,
	A8E_LibraryRepositoryRecord_t *pLocal,
	const A8E_LibraryRepository_t *pPackage,
	const A8E_LibraryRepositoryRecord_t *pSource,
	int *pChanged,
	char *pError,
	uint32_t lErrorSize)
{
	const char *pSourceBegin;
	const char *pSourceEnd;
	const char *pSourceArray;
	const char *pSourceArrayEnd;
	uint8_t *pObject = NULL;
	char *pRevisionObjects = NULL;
	char *pReplacement = NULL;
	uint32_t lObjectSize;
	uint32_t lRevisionObjects = 0;
	uint32_t lRevisionCapacity = 0;
	int bNewRevision = 0;
	int bRevisionChanged = 0;
	const char *p;
	if(pChanged) *pChanged = 0;
	if(!pMerged || !pLocal || !pPackage || !pSource ||
		pSource->lObjectEnd < pSource->lObjectStart) return 0;
	pSourceBegin = (const char *)pPackage->pManifest + pSource->lObjectStart;
	pSourceEnd = (const char *)pPackage->pManifest + pSource->lObjectEnd + 1u;
	pSourceArray = A8E_LibraryRepository_FindKey(
		pSourceBegin, pSourceEnd, "revisions");
	if(!pSourceArray || *pSourceArray != '[') return 1;
	pSourceArrayEnd = A8E_LibraryRepository_Match(
		pSourceArray, pSourceEnd, '[', ']');
	if(!pSourceArrayEnd) return 0;
	lObjectSize = pLocal->lObjectEnd - pLocal->lObjectStart + 1u;
	pObject = (uint8_t *)malloc(lObjectSize);
	if(!pObject) return 0;
	memcpy(pObject, pMerged->pManifest + pLocal->lObjectStart, lObjectSize);
	for(p = pSourceArray + 1; p < pSourceArrayEnd; p++)
	{
		const char *pRevisionEnd;
		char *pId;
		uint32_t lRevisionSize;
		if(*p != '{') continue;
		pRevisionEnd = A8E_LibraryRepository_Match(
			p, pSourceArrayEnd + 1, '{', '}');
		if(!pRevisionEnd) goto fail;
		pId = A8E_LibraryRepository_ReadString(
			A8E_LibraryRepository_FindKey(p, pRevisionEnd + 1, "id"),
			pRevisionEnd + 1);
		if(!pId) goto fail;
		if(!A8E_LibraryRepository_RevisionIdExists(
			(const char *)pObject, (const char *)pObject + lObjectSize, pId))
		{
			lRevisionSize = (uint32_t)(pRevisionEnd - p + 1u);
			if(lRevisionObjects + lRevisionSize + 2u > lRevisionCapacity)
			{
				uint32_t lNewCapacity = lRevisionCapacity
					? lRevisionCapacity * 2u : 1024u;
				while(lNewCapacity < lRevisionObjects + lRevisionSize + 2u)
					lNewCapacity *= 2u;
				pRevisionObjects = (char *)realloc(
					pRevisionObjects, lNewCapacity);
				if(!pRevisionObjects)
				{
					free(pId);
					goto fail;
				}
				lRevisionCapacity = lNewCapacity;
			}
			if(lRevisionObjects > 0u) pRevisionObjects[lRevisionObjects++] = ',';
			memcpy(pRevisionObjects + lRevisionObjects, p, lRevisionSize);
			lRevisionObjects += lRevisionSize;
			bNewRevision = 1;
			bRevisionChanged = 1;
		}
		free(pId);
		p = pRevisionEnd;
	}
	if(bNewRevision)
	{
		const char *pLocalBegin = (const char *)pObject;
		const char *pLocalEnd = pLocalBegin + lObjectSize;
		const char *pLocalArray = A8E_LibraryRepository_FindKey(
			pLocalBegin, pLocalEnd, "revisions");
		if(pLocalArray && *pLocalArray == '[')
		{
			const char *pLocalArrayEnd = A8E_LibraryRepository_Match(
				pLocalArray, pLocalEnd, '[', ']');
			uint32_t lLocalArraySize;
			uint32_t lReplacementSize;
			int bExisting;
			if(!pLocalArrayEnd) goto fail;
			lLocalArraySize = (uint32_t)(pLocalArrayEnd - pLocalArray + 1u);
			bExisting = A8E_LibraryRepository_SkipSpace(
				pLocalArray + 1, pLocalArrayEnd) < pLocalArrayEnd;
			lReplacementSize = lLocalArraySize + lRevisionObjects +
				(bExisting ? 1u : 0u);
			pReplacement = (char *)malloc(lReplacementSize);
			if(!pReplacement) goto fail;
			memcpy(pReplacement, pLocalArray, lLocalArraySize - 1u);
			lLocalArraySize--;
			if(bExisting) pReplacement[lLocalArraySize++] = ',';
			memcpy(pReplacement + lLocalArraySize,
				pRevisionObjects, lRevisionObjects);
			lLocalArraySize += lRevisionObjects;
			pReplacement[lLocalArraySize++] = ']';
			if(!A8E_LibraryRepository_ReplaceSpan(
				&pObject, &lObjectSize,
				(uint32_t)(pLocalArray - pLocalBegin),
				(uint32_t)(pLocalArrayEnd - pLocalBegin + 1u),
				pReplacement, lLocalArraySize)) goto fail;
		}
		else
		{
			char *pArray = (char *)malloc(lRevisionObjects + 3u);
			if(!pArray) goto fail;
			pArray[0] = '[';
			memcpy(pArray + 1, pRevisionObjects, lRevisionObjects);
			pArray[lRevisionObjects + 1u] = ']';
			pArray[lRevisionObjects + 2u] = '\0';
			if(!A8E_LibraryRepository_AppendObjectField(
				&pObject, &lObjectSize, "revisions", pArray))
			{
				free(pArray);
				goto fail;
			}
			free(pArray);
		}
	}
	{
		const char *pSourcePreferred = A8E_LibraryRepository_FindKey(
			pSourceBegin, pSourceEnd, "preferredRevisionId");
		if(pSourcePreferred)
		{
			const char *pPreferredEnd = A8E_LibraryRepository_ValueEnd(
				pSourcePreferred, pSourceEnd);
			if(!pPreferredEnd) goto fail;
			{
				uint32_t lPreferredSize = (uint32_t)(pPreferredEnd - pSourcePreferred);
				char *pPreferred = (char *)malloc(lPreferredSize + 1u);
				if(!pPreferred) goto fail;
				memcpy(pPreferred, pSourcePreferred, lPreferredSize);
				pPreferred[lPreferredSize] = '\0';
				if(!A8E_LibraryRepository_ReplaceOrAppendObjectField(
					&pObject, &lObjectSize, "preferredRevisionId", pPreferred))
				{
					free(pPreferred);
					goto fail;
				}
				free(pPreferred);
				bRevisionChanged = 1;
			}
		}
	}
	if(bRevisionChanged && !A8E_LibraryRepository_ReplaceSpan(
		&pMerged->pManifest, &pMerged->lManifestSize,
		pLocal->lObjectStart, pLocal->lObjectEnd + 1u,
		(const char *)pObject, lObjectSize)) goto fail;
	if(bRevisionChanged)
	{
		pLocal->lObjectEnd = pLocal->lObjectStart + lObjectSize - 1u;
		if(pChanged) *pChanged = 1;
	}
	free(pReplacement);
	free(pRevisionObjects);
	free(pObject);
	return 1;
fail:
	free(pReplacement);
	free(pRevisionObjects);
	free(pObject);
	return 0;
}

static int A8E_LibraryRepository_MergePackage(
	A8E_LibraryRepository_t *pMerged,
	const A8E_LibraryRepository_t *pPackage,
	A8E_LibraryProgressCallback pProgress,
	void *pUserData,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_ImportMap_t *pFolderMaps = NULL;
	A8E_LibraryRepository_ImportMap_t *pRecordMaps = NULL;
	uint16_t sFolderMapCount = 0;
	uint16_t sRecordMapCount = 0;
	uint16_t sFolderMapCapacity;
	uint16_t sRecordMapCapacity;
	uint16_t sProcessed;
	uint16_t i;
	int bChanged = 0;
	char sObject[512];
	if(!pMerged || !pPackage) return 0;
	if(pPackage->sFolderCount == 0xffffu || pPackage->sRecordCount == 0xffffu)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "package is too large");
		return 0;
	}
	sFolderMapCapacity = (uint16_t)(pPackage->sFolderCount + 1u);
	sRecordMapCapacity = (uint16_t)(pPackage->sRecordCount + 1u);
	pFolderMaps = (A8E_LibraryRepository_ImportMap_t *)calloc(
		sFolderMapCapacity, sizeof(*pFolderMaps));
	pRecordMaps = (A8E_LibraryRepository_ImportMap_t *)calloc(
		sRecordMapCapacity, sizeof(*pRecordMaps));
	if(!pFolderMaps || !pRecordMaps)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
		goto fail;
	}
	if(!A8E_LibraryRepository_AddImportMap(
		pFolderMaps, &sFolderMapCount, sFolderMapCapacity, "root", "root"))
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot map package root");
		goto fail;
	}
	sProcessed = 0;
	for(i = 0; i < pPackage->sFolderCount; i++)
		if(strcmp(pPackage->pFolders[i].pId, "root") == 0) sProcessed++;
	while(sProcessed < pPackage->sFolderCount)
	{
		int bProgress = 0;
		for(i = 0; i < pPackage->sFolderCount; i++)
		{
			const A8E_LibraryRepositoryFolder_t *pSource =
				&pPackage->pFolders[i];
			const char *pParentId;
			const char *pTargetParent;
			A8E_LibraryRepositoryFolder_t *pExisting;
			char sId[257];
			char *pFolderJson = NULL;
			uint32_t lFolderJsonSize = 0;
			uint16_t j;
			int bMapped = 0;
			if(strcmp(pSource->pId, "root") == 0)
				continue;
			if(A8E_LibraryRepository_FindImportMap(
				pFolderMaps, sFolderMapCount, pSource->pId)) continue;
			pParentId = pSource->pParentId && pSource->pParentId[0]
				? pSource->pParentId : "root";
			pTargetParent = A8E_LibraryRepository_FindImportMap(
				pFolderMaps, sFolderMapCount, pParentId);
			if(!pTargetParent) continue;
			pExisting = A8E_LibraryRepository_FindFolderByName(
				pMerged, pTargetParent, pSource->pName);
			if(pExisting)
			{
				bMapped = A8E_LibraryRepository_AddImportMap(
					pFolderMaps, &sFolderMapCount, sFolderMapCapacity,
					pSource->pId, pExisting->pId);
			}
			else
			{
				for(j = 1u; j < 100000u; j++)
				{
					int lLength = snprintf(sId, sizeof(sId),
						"import-folder-%u-%u", pMerged->lLibraryVersion, j);
					if(lLength < 0 || (size_t)lLength >= sizeof(sId)) break;
					if(!A8E_LibraryRepository_FindFolder(pMerged, sId, NULL)) break;
				}
				if(j == 100000u || !A8E_LibraryRepository_BuildFolderJson(
					sId, pTargetParent, pSource->pName,
					&pFolderJson, &lFolderJsonSize) ||
					!A8E_LibraryRepository_InsertFolderJson(
						pMerged, pFolderJson, lFolderJsonSize) ||
					!A8E_LibraryRepository_RefreshParsed(
						pMerged, pError, lErrorSize))
				{
					free(pFolderJson);
					A8E_LibraryRepository_SetError(
						pError, lErrorSize, "cannot merge package folder");
					goto fail;
				}
				free(pFolderJson);
				pExisting = A8E_LibraryRepository_FindFolder(pMerged, sId, NULL);
				bMapped = pExisting && A8E_LibraryRepository_AddImportMap(
					pFolderMaps, &sFolderMapCount, sFolderMapCapacity,
					pSource->pId, sId);
				bChanged = 1;
			}
			if(!bMapped)
			{
				A8E_LibraryRepository_SetError(
					pError, lErrorSize, "cannot map package folder");
				goto fail;
			}
			if(!A8E_LibraryRepository_ReportProgress(
				pProgress, pUserData, "merge", sProcessed,
				pPackage->sFolderCount + pPackage->sRecordCount,
				pSource->pName, pError, lErrorSize)) goto fail;
			sProcessed++;
			bProgress = 1;
		}
		if(!bProgress)
		{
			A8E_LibraryRepository_SetError(
				pError, lErrorSize, "package folder hierarchy is invalid");
			goto fail;
		}
	}
	for(i = 0; i < pPackage->sRecordCount; i++)
	{
		const A8E_LibraryRepositoryRecord_t *pSource = &pPackage->pRecords[i];
		const char *pFolderId = A8E_LibraryRepository_FindImportMap(
			pFolderMaps, sFolderMapCount,
			pSource->pFolderId ? pSource->pFolderId : "root");
		A8E_LibraryRepositoryRecord_t *pSameId;
		A8E_LibraryRepositoryRecord_t *pSameHash = NULL;
		char aSourceHash[65];
		char aLocalHash[65];
		char sId[257];
		char sName[257];
		char sQuoted[520];
		uint8_t *pObject;
		uint32_t lObjectSize;
		uint16_t j;
		if(!pFolderId || !A8E_LibraryRepository_RecordHash(
			pPackage, pSource, aSourceHash))
		{
			A8E_LibraryRepository_SetError(
				pError, lErrorSize, "package record payload is missing");
			goto fail;
		}
		pSameId = A8E_LibraryRepository_FindRecord(
			pMerged, pSource->pId, NULL);
		if(pSameId && A8E_LibraryRepository_RecordHash(
			pMerged, pSameId, aLocalHash) &&
			strcmp(aLocalHash, aSourceHash) == 0)
		{
			int bHistoryChanged = 0;
			if(!A8E_LibraryRepository_MergeRecordRevisions(
				pMerged, pSameId, pPackage, pSource, &bHistoryChanged,
				pError, lErrorSize))
			{
				A8E_LibraryRepository_SetError(
					pError, lErrorSize, "cannot merge package revisions");
				goto fail;
			}
			if(bHistoryChanged)
			{
				if(!A8E_LibraryRepository_RefreshParsed(
					pMerged, pError, lErrorSize)) goto fail;
				bChanged = 1;
			}
			if(!A8E_LibraryRepository_AddImportMap(
				pRecordMaps, &sRecordMapCount, sRecordMapCapacity,
				pSource->pId, pSource->pId))
			{
				A8E_LibraryRepository_SetError(
					pError, lErrorSize, "cannot map duplicate package entry");
				goto fail;
			}
			continue;
		}
		for(j = 0; j < pMerged->sRecordCount; j++)
		{
			A8E_LibraryRepositoryRecord_t *pCandidate =
				&pMerged->pRecords[j];
			if(A8E_LibraryRepository_RecordHash(
				pMerged, pCandidate, aLocalHash) &&
				strcmp(aLocalHash, aSourceHash) == 0)
			{
				pSameHash = pCandidate;
				break;
			}
		}
		if(pSameHash)
		{
			if(!A8E_LibraryRepository_AddImportMap(
				pRecordMaps, &sRecordMapCount, sRecordMapCapacity,
				pSource->pId, pSameHash->pId))
			{
				A8E_LibraryRepository_SetError(
					pError, lErrorSize, "cannot map duplicate payload");
				goto fail;
			}
			continue;
		}
		strncpy(sId, pSource->pId, sizeof(sId) - 1u);
		sId[sizeof(sId) - 1u] = '\0';
		if(pSameId)
		{
			int lLength = snprintf(sId, sizeof(sId),
				"%s-import-%.*s", pSource->pId, 8, aSourceHash);
			if(lLength < 0 || (size_t)lLength >= sizeof(sId))
				snprintf(sId, sizeof(sId), "import-entry-%.*s", 16, aSourceHash);
		}
		for(j = 2u; A8E_LibraryRepository_FindRecord(
			pMerged, sId, NULL) && j < 10000u; j++)
			snprintf(sId, sizeof(sId), "import-entry-%.*s-%u", 16, aSourceHash, j);
		if(j == 10000u)
		{
			A8E_LibraryRepository_SetError(pError, lErrorSize, "too many imported entries");
			goto fail;
		}
		if(!A8E_LibraryRepository_MakeImportedName(
			pMerged, pFolderId, pSource->pName, sName, sizeof(sName)))
		{
			A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot resolve imported name");
			goto fail;
		}
		lObjectSize = pSource->lObjectEnd - pSource->lObjectStart + 1u;
		pObject = (uint8_t *)malloc(lObjectSize);
		if(!pObject)
		{
			A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
			goto fail;
		}
		memcpy(pObject, pPackage->pManifest + pSource->lObjectStart, lObjectSize);
		if(!A8E_LibraryRepository_MakeJsonString(
			sQuoted, sizeof(sQuoted), sId) ||
			!A8E_LibraryRepository_ReplaceOrAppendObjectField(
				&pObject, &lObjectSize, "id", sQuoted) ||
			!A8E_LibraryRepository_MakeJsonString(
				sQuoted, sizeof(sQuoted), sName) ||
			!A8E_LibraryRepository_ReplaceOrAppendObjectField(
				&pObject, &lObjectSize, "name", sQuoted) ||
			!A8E_LibraryRepository_MakeJsonString(
				sQuoted, sizeof(sQuoted), pFolderId) ||
			!A8E_LibraryRepository_ReplaceOrAppendObjectField(
				&pObject, &lObjectSize, "folderId", sQuoted) ||
			!A8E_LibraryRepository_ReplaceOrAppendObjectField(
				&pObject, &lObjectSize, "mountedSlot", "-1") ||
			!A8E_LibraryRepository_InsertManifestObject(
				pMerged, "library", (const char *)pObject, lObjectSize) ||
			!A8E_LibraryRepository_RefreshParsed(
				pMerged, pError, lErrorSize) ||
			!A8E_LibraryRepository_AddImportMap(
				pRecordMaps, &sRecordMapCount, sRecordMapCapacity,
				pSource->pId, sId))
		{
			free(pObject);
			A8E_LibraryRepository_SetError(
				pError, lErrorSize, "cannot merge package entry");
			goto fail;
		}
		free(pObject);
		bChanged = 1;
		if(!A8E_LibraryRepository_ReportProgress(
			pProgress, pUserData, "merge",
			pPackage->sFolderCount + i + 1u,
			pPackage->sFolderCount + pPackage->sRecordCount,
			pSource->pName, pError, lErrorSize)) goto fail;
	}
	for(i = 0; i < pPackage->sPayloadCount; i++)
	{
		const A8E_LibraryArchiveEntry_t *pPayload = &pPackage->pPayloads[i];
		if(A8E_LibraryRepository_ManifestReferencesPath(
			pMerged->pManifest, pMerged->lManifestSize, pPayload->pName) &&
			!A8E_LibraryRepository_AddPayload(
				pMerged, pPayload->pName, pPayload->pBytes, pPayload->lSize))
		{
			A8E_LibraryRepository_SetError(
				pError, lErrorSize, "cannot merge package payload");
			goto fail;
		}
	}
	{
		const char *apEntryIds[8];
		uint8_t abWriteProtected[8];
		char asEntryIds[8][257];
		int bWorkspaceChanged = 0;
		uint32_t lDrive;
		for(lDrive = 0; lDrive < 8u; lDrive++)
		{
			strncpy(asEntryIds[lDrive], pMerged->acDeviceEntryId[lDrive],
				sizeof(asEntryIds[lDrive]) - 1u);
			asEntryIds[lDrive][sizeof(asEntryIds[lDrive]) - 1u] = '\0';
			abWriteProtected[lDrive] = pMerged->abDeviceWriteProtected[lDrive];
			apEntryIds[lDrive] = asEntryIds[lDrive][0] ? asEntryIds[lDrive] : NULL;
		}
		for(lDrive = 0; lDrive < 8u; lDrive++)
		{
			const char *pImportedId = pPackage->acDeviceEntryId[lDrive];
			const char *pMappedId;
			uint32_t lExistingDrive;
			int bAlreadyAssigned = 0;
			if(!pImportedId || !pImportedId[0] || apEntryIds[lDrive]) continue;
			pMappedId = A8E_LibraryRepository_FindImportMap(
				pRecordMaps, sRecordMapCount, pImportedId);
			if(!pMappedId || !A8E_LibraryRepository_FindRecord(
				pMerged, pMappedId, NULL)) continue;
			for(lExistingDrive = 0; lExistingDrive < 8u; lExistingDrive++)
				if(apEntryIds[lExistingDrive] && strcmp(
					apEntryIds[lExistingDrive], pMappedId) == 0)
				{
					bAlreadyAssigned = 1;
					break;
				}
			if(bAlreadyAssigned) continue;
			strncpy(asEntryIds[lDrive], pMappedId, sizeof(asEntryIds[lDrive]) - 1u);
			asEntryIds[lDrive][sizeof(asEntryIds[lDrive]) - 1u] = '\0';
			apEntryIds[lDrive] = asEntryIds[lDrive];
			abWriteProtected[lDrive] = pPackage->abDeviceWriteProtected[lDrive];
			bWorkspaceChanged = 1;
		}
		if(bWorkspaceChanged)
		{
			char *pWorkspaceJson = NULL;
			uint32_t lWorkspaceJsonSize = 0;
			if(!A8E_LibraryRepository_BuildWorkspaceJson(
				apEntryIds, abWriteProtected,
				&pWorkspaceJson, &lWorkspaceJsonSize) ||
				!A8E_LibraryRepository_ReplaceWorkspace(
					pMerged, pWorkspaceJson, lWorkspaceJsonSize))
			{
				free(pWorkspaceJson);
				A8E_LibraryRepository_SetError(
					pError, lErrorSize, "cannot merge package workspace");
				goto fail;
			}
			free(pWorkspaceJson);
			memset(pMerged->acDeviceEntryId, 0,
				sizeof(pMerged->acDeviceEntryId));
			memcpy(pMerged->abDeviceWriteProtected, abWriteProtected,
				sizeof(pMerged->abDeviceWriteProtected));
			for(lDrive = 0; lDrive < 8u; lDrive++)
				if(apEntryIds[lDrive])
				{
					strncpy(pMerged->acDeviceEntryId[lDrive], apEntryIds[lDrive],
						sizeof(pMerged->acDeviceEntryId[lDrive]) - 1u);
					pMerged->acDeviceEntryId[lDrive][
						sizeof(pMerged->acDeviceEntryId[lDrive]) - 1u] = '\0';
				}
			bChanged = 1;
		}
	}
	if(bChanged)
	{
		uint32_t lNextVersion = pMerged->lLibraryVersion == 0xffffffffu
			? 0xffffffffu : pMerged->lLibraryVersion + 1u;
		char sVersion[32];
		if(pPackage->lLibraryVersion > lNextVersion)
			lNextVersion = pPackage->lLibraryVersion;
		pMerged->lLibraryVersion = lNextVersion;
		snprintf(sVersion, sizeof(sVersion), "%u", lNextVersion);
		if(!A8E_LibraryRepository_ReplaceManifestField(
			pMerged, "libraryVersion", sVersion))
		{
			A8E_LibraryRepository_SetError(
				pError, lErrorSize, "cannot update imported library version");
			goto fail;
		}
	}
	A8E_LibraryRepository_FreeImportMaps(pFolderMaps, sFolderMapCount);
	A8E_LibraryRepository_FreeImportMaps(pRecordMaps, sRecordMapCount);
	return 1;
fail:
	A8E_LibraryRepository_FreeImportMaps(pFolderMaps, sFolderMapCount);
	A8E_LibraryRepository_FreeImportMaps(pRecordMaps, sRecordMapCount);
	return 0;
}

static const A8E_LibraryRepositoryFolder_t *A8E_LibraryRepository_FindPackageFolder(
	const A8E_LibraryRepository_t *pPackage,
	const char *pFolderId)
{
	uint16_t i;
	if(!pPackage || !pFolderId) return NULL;
	for(i = 0; i < pPackage->sFolderCount; i++)
		if(strcmp(pPackage->pFolders[i].pId, pFolderId) == 0)
			return &pPackage->pFolders[i];
	return NULL;
}

/* Resolve a package folder exactly as MergePackage does, without mutating a
 * repository. A synthetic ID represents a folder that will be created by the
 * merge and therefore cannot collide with a local entry yet. */
static int A8E_LibraryRepository_ResolvePreviewFolder(
	const A8E_LibraryRepository_t *pRepository,
	const A8E_LibraryRepository_t *pPackage,
	const char *pFolderId,
	uint16_t sDepth,
	char *pTargetId,
	uint32_t lTargetSize,
	int *pExisting)
{
	const A8E_LibraryRepositoryFolder_t *pSource;
	const A8E_LibraryRepositoryFolder_t *pLocal;
	char sParentId[257];
	if(!pPackage || !pFolderId || !pTargetId || lTargetSize == 0u ||
		sDepth > pPackage->sFolderCount)
		return 0;
	if(strcmp(pFolderId, "root") == 0)
	{
		if(strlen("root") >= lTargetSize) return 0;
		strcpy(pTargetId, "root");
		if(pExisting) *pExisting = 1;
		return 1;
	}
	pSource = A8E_LibraryRepository_FindPackageFolder(pPackage, pFolderId);
	if(!pSource) return 0;
	if(!A8E_LibraryRepository_ResolvePreviewFolder(
		pRepository, pPackage,
		pSource->pParentId && pSource->pParentId[0] ? pSource->pParentId : "root",
		sDepth + 1u, sParentId, sizeof(sParentId), NULL)) return 0;
	pLocal = pRepository ? A8E_LibraryRepository_FindFolderByName(
		(A8E_LibraryRepository_t *)pRepository, sParentId, pSource->pName) : NULL;
	if(pLocal)
	{
		if(strlen(pLocal->pId) >= lTargetSize) return 0;
		strcpy(pTargetId, pLocal->pId);
		if(pExisting) *pExisting = 1;
		return 1;
	}
	if(snprintf(pTargetId, lTargetSize, "preview-%s", pSource->pId) < 0 ||
		strlen(pTargetId) >= lTargetSize)
		return 0;
	if(pExisting) *pExisting = 0;
	return 1;
}

static int A8E_LibraryRepository_PreviewPackageFileInternal(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPackagePath,
	const A8E_LibraryPackageLimits_t *pLimits,
	A8E_LibraryPackagePreview_t *pPreview,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tPackage;
	A8E_LibraryArchiveEntry_t *pEntries = NULL;
	uint8_t *pArchive = NULL;
	uint32_t lArchiveSize = 0;
	uint32_t lLibraryVersion = 0;
	uint32_t lSchemaVersion = 1;
	uint16_t sEntryCount = 0;
	uint16_t sManifestIndex = 0xffffu;
	uint16_t i;
	if(!pPreview || !pPackagePath)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid package preview");
		return 0;
	}
	memset(pPreview, 0, sizeof(*pPreview));
	A8E_LibraryRepository_Init(&tPackage);
	if(!A8E_LibraryRepository_ReadFile(
		pPackagePath, &pArchive, &lArchiveSize, pError, lErrorSize) ||
		!A8E_LibraryPackage_ReadWithLimits(
			pArchive, lArchiveSize, pLimits, &pEntries, &sEntryCount,
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
	if(!A8E_LibraryPackage_ValidateManifestWithSchema(
		pEntries[sManifestIndex].pBytes, pEntries[sManifestIndex].lSize,
		&lSchemaVersion, &lLibraryVersion, pError, lErrorSize))
	{
		A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
		free(pArchive);
		return 0;
	}
	tPackage.pManifest = (uint8_t *)malloc(pEntries[sManifestIndex].lSize);
	if(!tPackage.pManifest)
	{
		A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
		free(pArchive);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
		return 0;
	}
	memcpy(tPackage.pManifest, pEntries[sManifestIndex].pBytes,
		pEntries[sManifestIndex].lSize);
	tPackage.lManifestSize = pEntries[sManifestIndex].lSize;
	tPackage.lLibraryVersion = lLibraryVersion;
	if(!A8E_LibraryRepository_ParseManifest(&tPackage, pError, lErrorSize) ||
		!A8E_LibraryRepository_ParseFolders(&tPackage, pError, lErrorSize))
	{
		A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
		free(pArchive);
		A8E_LibraryRepository_Free(&tPackage);
		return 0;
	}
	A8E_LibraryRepository_ParseWorkspace(&tPackage);
	for(i = 0; i < sEntryCount; i++)
		if(i != sManifestIndex && !A8E_LibraryRepository_AddPayload(
			&tPackage, pEntries[i].pName, pEntries[i].pBytes, pEntries[i].lSize))
		{
			A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
			free(pArchive);
			A8E_LibraryRepository_Free(&tPackage);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot stage package payload");
			return 0;
		}
	pPreview->sPackageEntryCount = tPackage.sRecordCount;
	pPreview->sPayloadCount = tPackage.sPayloadCount;
	pPreview->lPackageLibraryVersion = tPackage.lLibraryVersion;
	pPreview->lPackageSchemaVersion = lSchemaVersion;
	pPreview->bNewerSchemaVersion = lSchemaVersion > 1u;
	pPreview->bNewerLibraryVersion = pRepository &&
		tPackage.lLibraryVersion > pRepository->lLibraryVersion;
	for(i = 0; i < tPackage.sRecordCount; i++)
	{
		const A8E_LibraryRepositoryRecord_t *pSource = &tPackage.pRecords[i];
		const A8E_LibraryRepositoryRecord_t *pLocal = NULL;
		char sTargetFolderId[257];
		char aSourceHash[65];
		char aLocalHash[65];
		uint16_t j;
		if(!A8E_LibraryRepository_ResolvePreviewFolder(
			pRepository, &tPackage,
			pSource->pFolderId ? pSource->pFolderId : "root", 0u,
			sTargetFolderId, sizeof(sTargetFolderId), NULL))
		{
			A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
			free(pArchive);
			A8E_LibraryRepository_Free(&tPackage);
			A8E_LibraryRepository_SetError(pError, lErrorSize,
				"package folder hierarchy is invalid");
			return 0;
		}
		if(!A8E_LibraryRepository_RecordHash(&tPackage, pSource, aSourceHash))
		{
			A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
			free(pArchive);
			A8E_LibraryRepository_Free(&tPackage);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "package record payload is missing");
			return 0;
		}
		if(pRepository)
			for(j = 0; j < pRepository->sRecordCount; j++)
				if(strcmp(pRepository->pRecords[j].pId, pSource->pId) == 0)
				{
					pLocal = &pRepository->pRecords[j];
					break;
				}
		if(pLocal)
		{
			if(!A8E_LibraryRepository_RecordHash(pRepository, pLocal, aLocalHash))
			{
				A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
				free(pArchive);
				A8E_LibraryRepository_Free(&tPackage);
				A8E_LibraryRepository_SetError(pError, lErrorSize, "local record payload is missing");
				return 0;
			}
			if(strcmp(aSourceHash, aLocalHash) == 0) pPreview->sDuplicateCount++;
			else
			{
				int lModified = strcmp(
					pSource->pModifiedAt ? pSource->pModifiedAt : "",
					pLocal->pModifiedAt ? pLocal->pModifiedAt : "");
				pPreview->sConflictCount++;
				if(lModified > 0) pPreview->sNewerCount++;
				else if(lModified < 0) pPreview->sOlderCount++;
				else pPreview->sConcurrentCount++;
			}
			continue;
		}
		for(j = 0; pRepository && j < pRepository->sRecordCount; j++)
			if(A8E_LibraryRepository_RecordHash(
				pRepository, &pRepository->pRecords[j], aLocalHash) &&
				strcmp(aSourceHash, aLocalHash) == 0) break;
		if(pRepository && j < pRepository->sRecordCount) pPreview->sDuplicateCount++;
		else
		{
			pPreview->sNewEntryCount++;
			for(j = 0; pRepository && j < pRepository->sRecordCount; j++)
				if(A8E_LibraryRepository_NamesEqual(
					pRepository->pRecords[j].pName, pSource->pName) &&
					strcmp(pRepository->pRecords[j].pFolderId ?
						pRepository->pRecords[j].pFolderId : "root",
						sTargetFolderId) == 0)
				{
					pPreview->sNameCollisionCount++;
					break;
				}
		}
	}
	for(i = 0; i < tPackage.sFolderCount; i++)
	{
		const A8E_LibraryRepositoryFolder_t *pSource = &tPackage.pFolders[i];
		char sTargetFolderId[257];
		int bFound = 0;
		if(strcmp(pSource->pId, "root") == 0) continue;
		if(!A8E_LibraryRepository_ResolvePreviewFolder(
			pRepository, &tPackage, pSource->pId, 0u,
			sTargetFolderId, sizeof(sTargetFolderId), &bFound))
		{
			A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
			free(pArchive);
			A8E_LibraryRepository_Free(&tPackage);
			A8E_LibraryRepository_SetError(pError, lErrorSize,
				"package folder hierarchy is invalid");
			return 0;
		}
		if(!bFound && pPreview->sNewFolderCount < 0xffffu)
			pPreview->sNewFolderCount++;
	}
	for(i = 0; i < 8u; i++)
		if(!pRepository || !pRepository->acDeviceEntryId[i][0])
		{
			uint16_t j;
			for(j = 0; j < tPackage.sRecordCount; j++)
				if(tPackage.acDeviceEntryId[i][0] && strcmp(
					tPackage.acDeviceEntryId[i], tPackage.pRecords[j].pId) == 0)
				{
					if(pPreview->sRestoredDeviceCount < 8u)
						pPreview->sRestoredDeviceCount++;
					break;
				}
		}
	A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
	free(pArchive);
	A8E_LibraryRepository_Free(&tPackage);
	return 1;
}

int A8E_LibraryRepository_PreviewPackageFile(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPackagePath,
	A8E_LibraryPackagePreview_t *pPreview,
	char *pError,
	uint32_t lErrorSize)
{
	return A8E_LibraryRepository_PreviewPackageFileInternal(
		pRepository, pPackagePath, NULL, pPreview, pError, lErrorSize);
}

int A8E_LibraryRepository_PreviewPackageFileWithLimits(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPackagePath,
	const A8E_LibraryPackageLimits_t *pLimits,
	A8E_LibraryPackagePreview_t *pPreview,
	char *pError,
	uint32_t lErrorSize)
{
	return A8E_LibraryRepository_PreviewPackageFileInternal(
		pRepository, pPackagePath, pLimits, pPreview, pError, lErrorSize);
}

static int A8E_LibraryRepository_ImportPackageFileWithProgressInternal(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pPackagePath,
	A8E_LibraryProgressCallback pProgress,
	void *pUserData,
	const A8E_LibraryPackageLimits_t *pLimits,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryRepository_t tStaged;
	A8E_LibraryRepository_t tMerged;
	A8E_LibraryArchiveEntry_t *pEntries = NULL;
	uint8_t *pArchive = NULL;
	uint32_t lArchiveSize = 0;
	uint32_t lLibraryVersion = 0;
	uint16_t sEntryCount = 0;
	uint16_t sManifestIndex = 0xffffu;
	uint16_t i;
	char sManifestPath[A8E_REPOSITORY_MAX_PATH];
	FILE *pManifestFile;
	int bHadLocal = 0;

	if(!pRepository || !pRootPath || !pPackagePath)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid package import");
		return 0;
	}
	if(!A8E_LibraryRepository_ReadFile(
		pPackagePath, &pArchive, &lArchiveSize, pError, lErrorSize) ||
		!A8E_LibraryPackage_ReadWithLimits(
			pArchive, lArchiveSize, pLimits, &pEntries, &sEntryCount,
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
	if(!A8E_LibraryRepository_ParseManifest(&tStaged, pError, lErrorSize) ||
		!A8E_LibraryRepository_ParseFolders(&tStaged, pError, lErrorSize))
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
		if(!A8E_LibraryRepository_ReportProgress(
			pProgress, pUserData, "validate", i, sEntryCount,
			pEntries[i].pName, pError, lErrorSize))
		{
			A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
			free(pArchive);
			A8E_LibraryRepository_Free(&tStaged);
			return 0;
		}
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
	if(!A8E_LibraryRepository_ReportProgress(
		pProgress, pUserData, "validated", sEntryCount, sEntryCount,
		"library.json", pError, lErrorSize))
	{
		A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
		free(pArchive);
		A8E_LibraryRepository_Free(&tStaged);
		return 0;
	}
	if(!A8E_LibraryRepository_JoinPath(
		sManifestPath, sizeof(sManifestPath), pRootPath, "library.json"))
	{
		A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
		free(pArchive);
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid library path");
		return 0;
	}
	pManifestFile = fopen(sManifestPath, "rb");
	if(pManifestFile)
	{
		bHadLocal = 1;
		fclose(pManifestFile);
	}
	if(bHadLocal)
	{
		A8E_LibraryRepository_Init(&tMerged);
		if(!A8E_LibraryRepository_LoadDirectory(
			&tMerged, pRootPath, pError, lErrorSize) ||
			!A8E_LibraryRepository_MergePackage(
				&tMerged, &tStaged, pProgress, pUserData,
				pError, lErrorSize))
		{
			A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
			free(pArchive);
			A8E_LibraryRepository_Free(&tStaged);
			A8E_LibraryRepository_Free(&tMerged);
			return 0;
		}
		A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);
		free(pArchive);
		if(!A8E_LibraryRepository_SaveDirectory(
			&tMerged, pRootPath, pError, lErrorSize) ||
			!A8E_LibraryRepository_LoadDirectory(
				pRepository, pRootPath, pError, lErrorSize))
		{
			A8E_LibraryRepository_Free(&tStaged);
			A8E_LibraryRepository_Free(&tMerged);
			return 0;
		}
		A8E_LibraryRepository_Free(&tStaged);
		A8E_LibraryRepository_Free(&tMerged);
		return 1;
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

int A8E_LibraryRepository_ImportPackageFile(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pPackagePath,
	char *pError,
	uint32_t lErrorSize)
{
	return A8E_LibraryRepository_ImportPackageFileWithProgressInternal(
		pRepository, pRootPath, pPackagePath, NULL, NULL, NULL,
		pError, lErrorSize);
}

int A8E_LibraryRepository_ImportPackageFileWithLimits(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pPackagePath,
	const A8E_LibraryPackageLimits_t *pLimits,
	char *pError,
	uint32_t lErrorSize)
{
	return A8E_LibraryRepository_ImportPackageFileWithProgressInternal(
		pRepository, pRootPath, pPackagePath, NULL, NULL, pLimits,
		pError, lErrorSize);
}

int A8E_LibraryRepository_ImportPackageFileWithProgress(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pPackagePath,
	A8E_LibraryProgressCallback pProgress,
	void *pUserData,
	char *pError,
	uint32_t lErrorSize)
{
	return A8E_LibraryRepository_ImportPackageFileWithProgressInternal(
		pRepository, pRootPath, pPackagePath, pProgress, pUserData, NULL,
		pError, lErrorSize);
}

int A8E_LibraryRepository_ImportPackageFileWithProgressAndLimits(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pPackagePath,
	A8E_LibraryProgressCallback pProgress,
	void *pUserData,
	const A8E_LibraryPackageLimits_t *pLimits,
	char *pError,
	uint32_t lErrorSize)
{
	return A8E_LibraryRepository_ImportPackageFileWithProgressInternal(
		pRepository, pRootPath, pPackagePath, pProgress, pUserData, pLimits,
		pError, lErrorSize);
}

static int A8E_LibraryRepository_IsWorkspaceRecord(
	const A8E_LibraryRepository_t *pRepository,
	const A8E_LibraryRepositoryRecord_t *pRecord)
{
	uint32_t lDrive;
	if(!pRepository || !pRecord) return 0;
	for(lDrive = 0; lDrive < 8u; lDrive++)
		if(pRepository->acDeviceEntryId[lDrive][0] &&
			strcmp(pRepository->acDeviceEntryId[lDrive], pRecord->pId) == 0) return 1;
	return 0;
}

static int A8E_LibraryRepository_RemoveTrashField(
	uint8_t **ppManifest,
	uint32_t *pManifestSize)
{
	const char *pBegin;
	const char *pEnd;
	const char *pValue;
	const char *pKey = NULL;
	const char *pArrayEnd;
	const char *pFieldStart;
	const char *pFieldEnd;
	const char *p;
	if(!ppManifest || !*ppManifest || !pManifestSize) return 0;
	pBegin = (const char *)*ppManifest;
	pEnd = pBegin + *pManifestSize;
	pValue = A8E_LibraryRepository_FindKey(pBegin, pEnd, "trash");
	if(!pValue) return 1;
	for(p = pValue; p >= pBegin + 7u; p--)
		if(memcmp(p - 7, "\"trash\"", 7u) == 0)
		{
			pKey = p - 7;
			break;
		}
	if(!pKey || *pValue != '[' ||
		!(pArrayEnd = A8E_LibraryRepository_Match(pValue, pEnd, '[', ']'))) return 0;
	pFieldStart = pKey;
	while(pFieldStart > pBegin && isspace((unsigned char)pFieldStart[-1])) pFieldStart--;
	if(pFieldStart > pBegin && pFieldStart[-1] == ',') pFieldStart--;
	pFieldEnd = pArrayEnd + 1;
	while(pFieldEnd < pEnd && isspace((unsigned char)*pFieldEnd)) pFieldEnd++;
	if(pFieldEnd < pEnd && *pFieldEnd == ',') pFieldEnd++;
	return A8E_LibraryRepository_ReplaceSpan(
		ppManifest, pManifestSize,
		(uint32_t)(pFieldStart - pBegin), (uint32_t)(pFieldEnd - pBegin), "", 0u);
}

static int A8E_LibraryRepository_ManifestReferencesPath(
	const uint8_t *pManifest,
	uint32_t lManifestSize,
	const char *pPath)
{
	char sNeedle[1024];
	const char *p;
	const char *pEnd;
	size_t lNeedleSize;
	if(!pManifest || !pPath) return 0;
	if(snprintf(sNeedle, sizeof(sNeedle), "\"path\":\"%s\"", pPath) < 0) return 0;
	lNeedleSize = strlen(sNeedle);
	if(lNeedleSize >= sizeof(sNeedle)) return 0;
	p = (const char *)pManifest;
	pEnd = p + lManifestSize;
	while(p + lNeedleSize <= pEnd)
	{
		if(memcmp(p, sNeedle, lNeedleSize) == 0) return 1;
		p++;
	}
	return 0;
}

static int A8E_LibraryRepository_BuildWorkspaceManifest(
	const A8E_LibraryRepository_t *pRepository,
	uint8_t **ppManifest,
	uint32_t *pManifestSize)
{
	const char *pBegin;
	const char *pEnd;
	const char *pArray;
	const char *pArrayEnd;
	uint8_t *pOutput;
	uint32_t lPrefix;
	uint32_t lLength;
	uint16_t i;
	int bFirst = 1;
	if(!pRepository || !pRepository->pManifest || !ppManifest || !pManifestSize) return 0;
	*ppManifest = NULL;
	*pManifestSize = 0;
	pBegin = (const char *)pRepository->pManifest;
	pEnd = pBegin + pRepository->lManifestSize;
	pArray = A8E_LibraryRepository_FindKey(pBegin, pEnd, "library");
	if(!pArray || *pArray != '[' ||
		!(pArrayEnd = A8E_LibraryRepository_Match(pArray, pEnd, '[', ']'))) return 0;
	pOutput = (uint8_t *)malloc(pRepository->lManifestSize + 1u);
	if(!pOutput) return 0;
	lPrefix = (uint32_t)(pArray - pBegin) + 1u;
	memcpy(pOutput, pBegin, lPrefix);
	lLength = lPrefix;
	for(i = 0; i < pRepository->sRecordCount; i++)
	{
		const A8E_LibraryRepositoryRecord_t *pRecord = &pRepository->pRecords[i];
		uint32_t lObjectSize;
		if(!A8E_LibraryRepository_IsWorkspaceRecord(pRepository, pRecord)) continue;
		lObjectSize = pRecord->lObjectEnd - pRecord->lObjectStart + 1u;
		if(lLength + lObjectSize + 1u > pRepository->lManifestSize + 1u)
		{
			free(pOutput);
			return 0;
		}
		if(!bFirst) pOutput[lLength++] = ',';
		memcpy(pOutput + lLength, pBegin + pRecord->lObjectStart, lObjectSize);
		lLength += lObjectSize;
		bFirst = 0;
	}
	if(lLength + (uint32_t)(pEnd - pArrayEnd) > pRepository->lManifestSize + 1u)
	{
		free(pOutput);
		return 0;
	}
	memcpy(pOutput + lLength, pArrayEnd, (size_t)(pEnd - pArrayEnd));
	lLength += (uint32_t)(pEnd - pArrayEnd);
	pOutput[lLength] = '\0';
	if(!A8E_LibraryRepository_RemoveTrashField(&pOutput, &lLength))
	{
		free(pOutput);
		return 0;
	}
	*ppManifest = pOutput;
	*pManifestSize = lLength;
	return 1;
}

static int A8E_LibraryRepository_ExportPackageFileInternal(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPackagePath,
	int bWorkspaceOnly,
	A8E_LibraryProgressCallback pProgress,
	void *pUserData,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryArchiveInput_t *pInputs = NULL;
	uint8_t *pWorkspaceManifest = NULL;
	uint8_t *pArchive = NULL;
	uint32_t lArchiveSize = 0;
	const uint8_t *pManifest;
	uint32_t lManifestSize;
	uint16_t i;
	uint16_t sInputCount = 0;
	int lResult;
	if(!pRepository || !pPackagePath || !pRepository->pManifest)
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "invalid package export");
		return 0;
	}
	pManifest = pRepository->pManifest;
	lManifestSize = pRepository->lManifestSize;
	if(bWorkspaceOnly && !A8E_LibraryRepository_BuildWorkspaceManifest(
		pRepository, &pWorkspaceManifest, &lManifestSize))
	{
		A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot build workspace manifest");
		return 0;
	}
	if(pWorkspaceManifest) pManifest = pWorkspaceManifest;
	else
	{
		pWorkspaceManifest = (uint8_t *)malloc(lManifestSize + 1u);
		if(!pWorkspaceManifest)
		{
			A8E_LibraryRepository_SetError(pError, lErrorSize, "out of memory");
			return 0;
		}
		memcpy(pWorkspaceManifest, pManifest, lManifestSize);
		pWorkspaceManifest[lManifestSize] = '\0';
		if(!A8E_LibraryRepository_RemoveTrashField(
			&pWorkspaceManifest, &lManifestSize))
		{
			free(pWorkspaceManifest);
			A8E_LibraryRepository_SetError(pError, lErrorSize, "cannot build export manifest");
			return 0;
		}
		pManifest = pWorkspaceManifest;
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
		if(!A8E_LibraryRepository_ReportProgress(
			pProgress, pUserData, "export", i,
			pRepository->sPayloadCount,
			pRepository->pPayloads[i].pName, pError, lErrorSize))
		{
			free(pInputs);
			free(pWorkspaceManifest);
			return 0;
		}
		int bSelected = A8E_LibraryRepository_ManifestReferencesPath(
			(const uint8_t *)pManifest, lManifestSize,
			pRepository->pPayloads[i].pName);
		if(!bSelected) continue;
		pInputs[sInputCount].pName = pRepository->pPayloads[i].pName;
		pInputs[sInputCount].pBytes = pRepository->pPayloads[i].pBytes;
		pInputs[sInputCount].lSize = pRepository->pPayloads[i].lSize;
		sInputCount++;
	}
	if(!A8E_LibraryRepository_ReportProgress(
		pProgress, pUserData, "archive", pRepository->sPayloadCount,
		pRepository->sPayloadCount, pPackagePath, pError, lErrorSize))
	{
		free(pInputs);
		free(pWorkspaceManifest);
		return 0;
	}
	lResult = A8E_LibraryPackage_Write(
		pManifest, lManifestSize, pInputs, sInputCount, &pArchive, &lArchiveSize,
		pError, lErrorSize);
	free(pInputs);
	free(pWorkspaceManifest);
	if(!lResult) return 0;
	lResult = A8E_LibraryRepository_WriteFile(
		pPackagePath, pArchive, lArchiveSize, pError, lErrorSize);
	free(pArchive);
	return lResult;
}

int A8E_LibraryRepository_ExportPackageFile(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPackagePath,
	char *pError,
	uint32_t lErrorSize)
{
	return A8E_LibraryRepository_ExportPackageFileInternal(
		pRepository, pPackagePath, 0, NULL, NULL, pError, lErrorSize);
}

int A8E_LibraryRepository_ExportPackageFileWithProgress(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPackagePath,
	A8E_LibraryProgressCallback pProgress,
	void *pUserData,
	char *pError,
	uint32_t lErrorSize)
{
	return A8E_LibraryRepository_ExportPackageFileInternal(
		pRepository, pPackagePath, 0, pProgress, pUserData,
		pError, lErrorSize);
}

int A8E_LibraryRepository_ExportWorkspacePackageFile(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPackagePath,
	char *pError,
	uint32_t lErrorSize)
{
	return A8E_LibraryRepository_ExportPackageFileInternal(
		pRepository, pPackagePath, 1, NULL, NULL, pError, lErrorSize);
}

int A8E_LibraryRepository_ExportWorkspacePackageFileWithProgress(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPackagePath,
	A8E_LibraryProgressCallback pProgress,
	void *pUserData,
	char *pError,
	uint32_t lErrorSize)
{
	return A8E_LibraryRepository_ExportPackageFileInternal(
		pRepository, pPackagePath, 1, pProgress, pUserData,
		pError, lErrorSize);
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
			if(!A8E_LibraryRepository_ParseManifest(&tStaged, pError, lErrorSize) ||
				!A8E_LibraryRepository_ParseFolders(&tStaged, pError, lErrorSize))
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
