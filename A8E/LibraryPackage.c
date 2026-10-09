#include "LibraryPackage.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct
{
	uint32_t aState[8];
	uint64_t llBitLength;
	uint8_t aData[64];
	uint32_t lDataLength;
} Sha256Context_t;

static const uint32_t aSha256Words[64] = {
	0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u,
	0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
	0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
	0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
	0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu,
	0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
	0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
	0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
	0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
	0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
	0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u,
	0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
	0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u,
	0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
	0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
	0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u,
};

static uint32_t Sha256RotateRight(uint32_t lValue, uint32_t lBits)
{
	return (lValue >> lBits) | (lValue << (32u - lBits));
}

static void Sha256Transform(Sha256Context_t *pContext, const uint8_t *pData)
{
	uint32_t aSchedule[64];
	uint32_t a[8];
	uint32_t i;
	for(i = 0; i < 16; i++)
	{
		aSchedule[i] = ((uint32_t)pData[i * 4] << 24) |
			((uint32_t)pData[i * 4 + 1] << 16) |
			((uint32_t)pData[i * 4 + 2] << 8) |
			(uint32_t)pData[i * 4 + 3];
	}
	for(i = 16; i < 64; i++)
	{
		uint32_t s0 = Sha256RotateRight(aSchedule[i - 15], 7) ^
			Sha256RotateRight(aSchedule[i - 15], 18) ^ (aSchedule[i - 15] >> 3);
		uint32_t s1 = Sha256RotateRight(aSchedule[i - 2], 17) ^
			Sha256RotateRight(aSchedule[i - 2], 19) ^ (aSchedule[i - 2] >> 10);
		aSchedule[i] = aSchedule[i - 16] + s0 + aSchedule[i - 7] + s1;
	}
	memcpy(a, pContext->aState, sizeof(a));
	for(i = 0; i < 64; i++)
	{
		uint32_t s1 = Sha256RotateRight(a[4], 6) ^
			Sha256RotateRight(a[4], 11) ^ Sha256RotateRight(a[4], 25);
		uint32_t choice = (a[4] & a[5]) ^ (~a[4] & a[6]);
		uint32_t temp1 = a[7] + s1 + choice + aSha256Words[i] + aSchedule[i];
		uint32_t s0 = Sha256RotateRight(a[0], 2) ^
			Sha256RotateRight(a[0], 13) ^ Sha256RotateRight(a[0], 22);
		uint32_t majority = (a[0] & a[1]) ^ (a[0] & a[2]) ^ (a[1] & a[2]);
		uint32_t temp2 = s0 + majority;
		a[7] = a[6]; a[6] = a[5]; a[5] = a[4]; a[4] = a[3] + temp1;
		a[3] = a[2]; a[2] = a[1]; a[1] = a[0]; a[0] = temp1 + temp2;
	}
	for(i = 0; i < 8; i++) pContext->aState[i] += a[i];
}

static void Sha256Init(Sha256Context_t *pContext)
{
	static const uint32_t aInitial[8] = {
		0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
		0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u,
	};
	memset(pContext, 0, sizeof(*pContext));
	memcpy(pContext->aState, aInitial, sizeof(aInitial));
}

static void Sha256Update(Sha256Context_t *pContext, const uint8_t *pData, uint32_t lSize)
{
	uint32_t i;
	for(i = 0; i < lSize; i++)
	{
		pContext->aData[pContext->lDataLength++] = pData[i];
		if(pContext->lDataLength == 64)
		{
			Sha256Transform(pContext, pContext->aData);
			pContext->llBitLength += 512;
			pContext->lDataLength = 0;
		}
	}
}

static void Sha256Final(Sha256Context_t *pContext, uint8_t aDigest[32])
{
	uint32_t i = pContext->lDataLength;
	pContext->aData[i++] = 0x80;
	while(i < 56) pContext->aData[i++] = 0;
	if(pContext->lDataLength >= 56)
	{
		while(i < 64) pContext->aData[i++] = 0;
		Sha256Transform(pContext, pContext->aData);
		memset(pContext->aData, 0, 56);
	}
	pContext->llBitLength += (uint64_t)pContext->lDataLength * 8u;
	for(i = 0; i < 8; i++)
	{
		pContext->aData[63 - i] = (uint8_t)(pContext->llBitLength >> (i * 8));
	}
	Sha256Transform(pContext, pContext->aData);
	for(i = 0; i < 8; i++)
	{
		aDigest[i * 4] = (uint8_t)(pContext->aState[i] >> 24);
		aDigest[i * 4 + 1] = (uint8_t)(pContext->aState[i] >> 16);
		aDigest[i * 4 + 2] = (uint8_t)(pContext->aState[i] >> 8);
		aDigest[i * 4 + 3] = (uint8_t)pContext->aState[i];
	}
}

static void Sha256Hex(const uint8_t *pData, uint32_t lSize, char aHex[65])
{
	static const char sHex[] = "0123456789abcdef";
	uint8_t aDigest[32];
	Sha256Context_t tContext;
	uint32_t i;
	Sha256Init(&tContext);
	if(lSize > 0) Sha256Update(&tContext, pData, lSize);
	Sha256Final(&tContext, aDigest);
	for(i = 0; i < 32; i++)
	{
		aHex[i * 2] = sHex[aDigest[i] >> 4];
		aHex[i * 2 + 1] = sHex[aDigest[i] & 15];
	}
	aHex[64] = '\0';
}

void A8E_LibraryPackage_Sha256Hex(
	const uint8_t *pBytes,
	uint32_t lSize,
	char aHex[65])
{
	Sha256Hex(pBytes, lSize, aHex);
}

static void SetError(char *pError, uint32_t lErrorSize, const char *pMessage)
{
	if(!pError || lErrorSize == 0) return;
	snprintf(pError, lErrorSize, "%s", pMessage ? pMessage : "library package error");
}

static const char *SkipSpace(const char *p, const char *pEnd)
{
	while(p < pEnd && isspace((unsigned char)*p)) p++;
	return p;
}

static const char *FindBytes(
	const char *pText,
	const char *pEnd,
	const char *pNeedle,
	size_t lNeedleSize)
{
	while(pText < pEnd)
	{
		if((size_t)(pEnd - pText) >= lNeedleSize && memcmp(pText, pNeedle, lNeedleSize) == 0)
			return pText;
		pText++;
	}
	return NULL;
}

static const char *FindKeyValue(
	const char *pJson,
	uint32_t lJsonSize,
	const char *pKey)
{
	char sNeedle[128];
	int lNeedle;
	const char *pEnd = pJson + lJsonSize;
	const char *pFound;
	size_t lKeyLength;

	lNeedle = snprintf(sNeedle, sizeof(sNeedle), "\"%s\"", pKey);
	if(lNeedle <= 0 || (size_t)lNeedle >= sizeof(sNeedle)) return NULL;
	lKeyLength = (size_t)lNeedle;
	pFound = pJson;
	while(pFound < pEnd)
	{
		const char *pMatch = pFound;
		while(pMatch < pEnd &&
			((size_t)(pEnd - pMatch) < lKeyLength || memcmp(pMatch, sNeedle, lKeyLength) != 0))
			pMatch++;
		if(pMatch >= pEnd) return NULL;
		pMatch += lNeedle;
		pMatch = SkipSpace(pMatch, pEnd);
		if(pMatch >= pEnd || *pMatch != ':')
		{
			pFound = pMatch;
			continue;
		}
		return SkipSpace(pMatch + 1, pEnd);
	}
	return NULL;
}

static int ReadStringValue(
	const char *pValue,
	const char *pEnd,
	const char *pExpected)
{
	size_t lExpected;
	if(!pValue || pValue >= pEnd || *pValue != '"') return 0;
	pValue++;
	lExpected = strlen(pExpected);
	if((size_t)(pEnd - pValue) < lExpected + 1 || memcmp(pValue, pExpected, lExpected) != 0)
		return 0;
	return pValue[lExpected] == '"';
}

static int ReadIntegerValue(
	const char *pValue,
	const char *pEnd,
	uint32_t *pResult)
{
	uint64_t lValue = 0;
	const char *pStop;
	if(!pValue || pValue >= pEnd || !isdigit((unsigned char)*pValue)) return 0;
	pStop = pValue;
	while(pStop < pEnd && isdigit((unsigned char)*pStop))
	{
		lValue = lValue * 10u + (uint64_t)(*pStop - '0');
		if(lValue > 0xffffffffu) return 0;
		pStop++;
	}
	if(lValue == 0) return 0;
	if(pResult) *pResult = (uint32_t)lValue;
	return 1;
}

static int VerifyPayloadManifest(
	const uint8_t *pJson,
	uint32_t lJsonSize,
	const char *pName,
	const uint8_t *pBytes,
	uint32_t lSize,
	char *pError,
	uint32_t lErrorSize)
{
	const char *pText = (const char *)pJson;
	const char *pEnd = pText + lJsonSize;
	const char *pPath;
	const char *pNextPath;
	const char *pSha;
	const char *pSize;
	char *pNeedle;
	char aHash[65];
	uint32_t lManifestSize;
	size_t lNameSize = strlen(pName);
	size_t lNeedleSize = lNameSize + 9;
	static const char sShaPrefix[] = "\"sha256\":\"";

	pNeedle = (char *)malloc(lNeedleSize + 1);
	if(!pNeedle)
	{
		SetError(pError, lErrorSize, "out of memory");
		return 0;
	}
	snprintf(pNeedle, lNeedleSize + 1, "\"path\":\"%s\"", pName);
	pPath = FindBytes(pText, pEnd, pNeedle, lNeedleSize);
	free(pNeedle);
	if(!pPath)
	{
		SetError(pError, lErrorSize, "blob is not referenced by library.json");
		return 0;
	}
	pNextPath = FindBytes(pPath + lNeedleSize, pEnd, "\"path\":\"", 8);
	if(!pNextPath) pNextPath = pEnd;
	pSha = FindBytes(pPath, pNextPath, sShaPrefix, sizeof(sShaPrefix) - 1);
	if(!pSha || (size_t)(pNextPath - pSha) < sizeof(sShaPrefix) - 1 + 65)
	{
		SetError(pError, lErrorSize, "blob SHA-256 is missing");
		return 0;
	}
	Sha256Hex(pBytes, lSize, aHash);
	if(memcmp(pSha + sizeof(sShaPrefix) - 1, aHash, 64) != 0 ||
		pSha[sizeof(sShaPrefix) - 1 + 64] != '"')
	{
		SetError(pError, lErrorSize, "blob SHA-256 mismatch");
		return 0;
	}
	pSize = FindKeyValue(pPath, (uint32_t)(pNextPath - pPath), "size");
	if(!ReadIntegerValue(pSize, pNextPath, &lManifestSize) || lManifestSize != lSize)
	{
		SetError(pError, lErrorSize, "blob size mismatch");
		return 0;
	}
	return 1;
}

static uint32_t CountUniquePathReferences(const uint8_t *pJson, uint32_t lJsonSize)
{
	const char *p = (const char *)pJson;
	const char *pEnd = p + lJsonSize;
	uint32_t lCount = 0;
	while((p = FindBytes(p, pEnd, "\"path\":\"", 8)) != NULL)
	{
		const char *pValue = p + 8;
		const char *pValueEnd = (const char *)memchr(pValue, '"', (size_t)(pEnd - pValue));
		const char *pPrevious = (const char *)pJson;
		int lSeen = 0;
		if(!pValueEnd) break;
		while((pPrevious = FindBytes(pPrevious, p, "\"path\":\"", 8)) != NULL)
		{
			const char *pPreviousValue = pPrevious + 8;
			const char *pPreviousEnd = (const char *)memchr(
				pPreviousValue, '"', (size_t)(p - pPreviousValue));
			if(pPreviousEnd &&
				(size_t)(pPreviousEnd - pPreviousValue) == (size_t)(pValueEnd - pValue) &&
				memcmp(pPreviousValue, pValue, (size_t)(pValueEnd - pValue)) == 0)
			{
				lSeen = 1;
				break;
			}
			pPrevious = pPrevious + 8;
		}
		if(!lSeen) lCount++;
		p = pValueEnd + 1;
	}
	return lCount;
}

int A8E_LibraryPackage_ValidateManifest(
	const uint8_t *pJson,
	uint32_t lJsonSize,
	uint32_t *pLibraryVersion,
	char *pError,
	uint32_t lErrorSize)
{
	const char *pText = (const char *)pJson;
	const char *pEnd = pText ? pText + lJsonSize : NULL;
	const char *pValue;
	uint32_t lVersion = 0;

	if(!pText || lJsonSize == 0)
	{
		SetError(pError, lErrorSize, "manifest is empty");
		return 0;
	}
	pValue = FindKeyValue(pText, lJsonSize, "format");
	if(!ReadStringValue(pValue, pEnd, "a8e-library-export"))
	{
		SetError(pError, lErrorSize, "unsupported format");
		return 0;
	}
	pValue = FindKeyValue(pText, lJsonSize, "schemaVersion");
	if(!pValue || !ReadIntegerValue(pValue, pEnd, &lVersion) || lVersion != 1)
	{
		SetError(pError, lErrorSize, "unsupported schemaVersion");
		return 0;
	}
	pValue = FindKeyValue(pText, lJsonSize, "libraryVersion");
	if(!ReadIntegerValue(pValue, pEnd, &lVersion))
	{
		SetError(pError, lErrorSize, "invalid libraryVersion");
		return 0;
	}
	pValue = FindKeyValue(pText, lJsonSize, "createdAt");
	if(!pValue || *pValue != '"' ||
		memchr(pValue + 1, '"', (size_t)(pEnd - pValue - 1)) == NULL)
	{
		SetError(pError, lErrorSize, "invalid createdAt");
		return 0;
	}
	pValue = FindKeyValue(pText, lJsonSize, "library");
	if(!pValue || *pValue != '[')
	{
		SetError(pError, lErrorSize, "library must be an array");
		return 0;
	}
	if(pLibraryVersion) *pLibraryVersion = lVersion;
	return 1;
}

int A8E_LibraryPackage_Write(
	const uint8_t *pManifest,
	uint32_t lManifestSize,
	const A8E_LibraryArchiveInput_t *pPayloads,
	uint16_t sPayloadCount,
	uint8_t **ppArchive,
	uint32_t *pArchiveSize,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryArchiveInput_t *pEntries;
	uint16_t i;
	int lResult;
	if(!A8E_LibraryPackage_ValidateManifest(
		pManifest, lManifestSize, NULL, pError, lErrorSize)) return 0;
	if(sPayloadCount > 0 && !pPayloads)
	{
		SetError(pError, lErrorSize, "payload array is missing");
		return 0;
	}
	pEntries = (A8E_LibraryArchiveInput_t *)calloc(
		(size_t)sPayloadCount + 1u, sizeof(*pEntries));
	if(!pEntries)
	{
		SetError(pError, lErrorSize, "out of memory");
		return 0;
	}
	pEntries[0].pName = "library.json";
	pEntries[0].pBytes = pManifest;
	pEntries[0].lSize = lManifestSize;
	for(i = 0; i < sPayloadCount; i++)
	{
		if(!pPayloads[i].pName || strncmp(pPayloads[i].pName, "blobs/", 6) != 0 ||
			strcmp(pPayloads[i].pName, "library.json") == 0)
		{
			free(pEntries);
			SetError(pError, lErrorSize, "invalid payload name");
			return 0;
		}
		if(!VerifyPayloadManifest(
			pManifest, lManifestSize, pPayloads[i].pName,
			pPayloads[i].pBytes, pPayloads[i].lSize, pError, lErrorSize))
		{
			free(pEntries);
			return 0;
		}
		pEntries[i + 1] = pPayloads[i];
	}
	lResult = A8E_LibraryArchive_Write(
		pEntries, (uint16_t)(sPayloadCount + 1), ppArchive, pArchiveSize, pError, lErrorSize);
	free(pEntries);
	return lResult;
}

int A8E_LibraryPackage_Read(
	const uint8_t *pArchive,
	uint32_t lArchiveSize,
	A8E_LibraryArchiveEntry_t **ppEntries,
	uint16_t *pEntryCount,
	uint32_t *pLibraryVersion,
	char *pError,
	uint32_t lErrorSize)
{
	A8E_LibraryArchiveEntry_t *pEntries = NULL;
	uint16_t sCount = 0;
	uint16_t i;
	uint32_t lPathCount = 0;
	uint32_t lBlobCount = 0;
	int lResult;
	if(!A8E_LibraryArchive_Read(
		pArchive, lArchiveSize, &pEntries, &sCount, pError, lErrorSize)) return 0;
	for(i = 0; i < sCount; i++)
	{
		if(strcmp(pEntries[i].pName, "library.json") == 0)
		{
			lResult = A8E_LibraryPackage_ValidateManifest(
				pEntries[i].pBytes, pEntries[i].lSize,
				pLibraryVersion, pError, lErrorSize);
			if(!lResult)
			{
				A8E_LibraryArchive_FreeEntries(pEntries, sCount);
				return 0;
			}
			lPathCount = CountUniquePathReferences(pEntries[i].pBytes, pEntries[i].lSize);
			{
				uint16_t j;
				for(j = 0; j < sCount; j++)
				{
					if(strncmp(pEntries[j].pName, "blobs/", 6) != 0) continue;
					lBlobCount++;
					if(!VerifyPayloadManifest(
						pEntries[i].pBytes, pEntries[i].lSize,
						pEntries[j].pName, pEntries[j].pBytes, pEntries[j].lSize,
						pError, lErrorSize))
					{
						A8E_LibraryArchive_FreeEntries(pEntries, sCount);
						return 0;
					}
				}
			}
			if(lPathCount != lBlobCount)
			{
				A8E_LibraryArchive_FreeEntries(pEntries, sCount);
				SetError(pError, lErrorSize, "manifest/blob count mismatch");
				return 0;
			}
			if(ppEntries) *ppEntries = pEntries;
			if(pEntryCount) *pEntryCount = sCount;
			return 1;
		}
	}
	A8E_LibraryArchive_FreeEntries(pEntries, sCount);
	SetError(pError, lErrorSize, "library.json is missing");
	return 0;
}
