#include "LibraryArchive.h"

#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define ZIP_LOCAL_SIGNATURE 0x04034b50u
#define ZIP_CENTRAL_SIGNATURE 0x02014b50u
#define ZIP_END_SIGNATURE 0x06054b50u
#define ZIP_UTF8_FLAG 0x0800u

typedef struct
{
    uint8_t *pData;
    size_t lSize;
    size_t lCapacity;
} ByteBuffer_t;

static void SetError(char *pError, size_t lErrorSize, const char *pMessage)
{
    if(pError != NULL && lErrorSize > 0)
    {
        snprintf(pError, lErrorSize, "%s", pMessage);
    }
}

static int BufferReserve(ByteBuffer_t *pBuffer, size_t lAdditional)
{
    size_t lRequired;
    size_t lCapacity;
    uint8_t *pNewData;

    if(lAdditional > SIZE_MAX - pBuffer->lSize)
    {
        return 0;
    }
    lRequired = pBuffer->lSize + lAdditional;
    if(lRequired <= pBuffer->lCapacity)
    {
        return 1;
    }

    lCapacity = pBuffer->lCapacity == 0 ? 256 : pBuffer->lCapacity;
    while(lCapacity < lRequired)
    {
        if(lCapacity > SIZE_MAX / 2)
        {
            lCapacity = lRequired;
            break;
        }
        lCapacity *= 2;
    }
    pNewData = (uint8_t *)realloc(pBuffer->pData, lCapacity);
    if(pNewData == NULL)
    {
        return 0;
    }
    pBuffer->pData = pNewData;
    pBuffer->lCapacity = lCapacity;
    return 1;
}

static int BufferAppend(ByteBuffer_t *pBuffer, const void *pData, size_t lSize)
{
    if(!BufferReserve(pBuffer, lSize))
    {
        return 0;
    }
    if(lSize > 0)
    {
        memcpy(pBuffer->pData + pBuffer->lSize, pData, lSize);
        pBuffer->lSize += lSize;
    }
    return 1;
}

static int BufferAppendU16(ByteBuffer_t *pBuffer, uint16_t sValue)
{
    uint8_t aBytes[2];
    aBytes[0] = (uint8_t)(sValue & 0xffu);
    aBytes[1] = (uint8_t)(sValue >> 8);
    return BufferAppend(pBuffer, aBytes, sizeof(aBytes));
}

static int BufferAppendU32(ByteBuffer_t *pBuffer, uint32_t lValue)
{
    uint8_t aBytes[4];
    aBytes[0] = (uint8_t)(lValue & 0xffu);
    aBytes[1] = (uint8_t)((lValue >> 8) & 0xffu);
    aBytes[2] = (uint8_t)((lValue >> 16) & 0xffu);
    aBytes[3] = (uint8_t)(lValue >> 24);
    return BufferAppend(pBuffer, aBytes, sizeof(aBytes));
}

static uint16_t ReadU16(const uint8_t *pData)
{
    return (uint16_t)pData[0] | (uint16_t)((uint16_t)pData[1] << 8);
}

static uint32_t ReadU32(const uint8_t *pData)
{
    return (uint32_t)pData[0] |
           ((uint32_t)pData[1] << 8) |
           ((uint32_t)pData[2] << 16) |
           ((uint32_t)pData[3] << 24);
}

static int HasRange(size_t lOffset, size_t lLength, size_t lTotal)
{
    return lOffset <= lTotal && lLength <= lTotal - lOffset;
}

static int ValidateName(const char *pName, size_t lLength)
{
    size_t lStart = 0;
    size_t i;

    if(pName == NULL || lLength == 0 || lLength > 0xffffu || pName[0] == '/')
    {
        return 0;
    }
    for(i = 0; i < lLength; i++)
    {
        uint8_t cFirst = (uint8_t)pName[i];
        size_t lSequenceLength;
        uint32_t lCodePoint;
        size_t j;

        if(cFirst <= 0x7fu)
        {
            if(cFirst == 0) return 0;
            continue;
        }
        if((cFirst & 0xe0u) == 0xc0u)
        {
            lSequenceLength = 2;
            lCodePoint = cFirst & 0x1fu;
            if(lCodePoint < 2) return 0;
        }
        else if((cFirst & 0xf0u) == 0xe0u)
        {
            lSequenceLength = 3;
            lCodePoint = cFirst & 0x0fu;
        }
        else if((cFirst & 0xf8u) == 0xf0u)
        {
            lSequenceLength = 4;
            lCodePoint = cFirst & 0x07u;
        }
        else
        {
            return 0;
        }
        if(i + lSequenceLength > lLength)
        {
            return 0;
        }
        for(j = 1; j < lSequenceLength; j++)
        {
            uint8_t cNext = (uint8_t)pName[i + j];
            if((cNext & 0xc0u) != 0x80u)
            {
                return 0;
            }
            lCodePoint = (lCodePoint << 6) | (cNext & 0x3fu);
        }
        if((lSequenceLength == 3 && lCodePoint < 0x800u) ||
           (lSequenceLength == 4 && lCodePoint < 0x10000u) ||
           lCodePoint > 0x10ffffu ||
           (lCodePoint >= 0xd800u && lCodePoint <= 0xdfffu))
        {
            return 0;
        }
        i += lSequenceLength - 1;
    }
    for(i = 0; i <= lLength; i++)
    {
        if(i == lLength || pName[i] == '/')
        {
            size_t lSegmentLength = i - lStart;
            if(lSegmentLength == 0 ||
               (lSegmentLength == 1 && pName[lStart] == '.') ||
               (lSegmentLength == 2 && pName[lStart] == '.' && pName[lStart + 1] == '.'))
            {
                return 0;
            }
            lStart = i + 1;
        }
        else if(pName[i] == '\\' || pName[i] == ':')
        {
            return 0;
        }
    }
    return 1;
}

static int DuplicateName(
    const A8E_LibraryArchiveInput_t *pEntries,
    uint16_t sIndex,
    const char *pName,
    size_t lNameLength)
{
    uint16_t i;
    for(i = 0; i < sIndex; i++)
    {
        size_t lExistingLength = strlen(pEntries[i].pName);
        if(lExistingLength == lNameLength &&
           memcmp(pEntries[i].pName, pName, lNameLength) == 0)
        {
            return 1;
        }
    }
    return 0;
}

uint32_t A8E_LibraryArchive_Crc32(const uint8_t *pBytes, uint32_t lSize)
{
    uint32_t lCrc = 0xffffffffu;
    uint32_t i;

    for(i = 0; i < lSize; i++)
    {
        uint8_t cValue = pBytes != NULL ? pBytes[i] : 0;
        uint8_t j;
        lCrc ^= cValue;
        for(j = 0; j < 8; j++)
        {
            lCrc = (lCrc >> 1) ^ ((lCrc & 1u) ? 0xedb88320u : 0u);
        }
    }
    return lCrc ^ 0xffffffffu;
}

int A8E_LibraryArchive_Write(
    const A8E_LibraryArchiveInput_t *pEntries,
    uint16_t sEntryCount,
    uint8_t **ppArchive,
    uint32_t *plArchiveSize,
    char *pError,
    size_t lErrorSize)
{
    ByteBuffer_t tArchive = { 0 };
    uint32_t *pOffsets = NULL;
    uint16_t i;

    if(ppArchive == NULL || plArchiveSize == NULL || (sEntryCount > 0 && pEntries == NULL))
    {
        SetError(pError, lErrorSize, "invalid output arguments");
        return 0;
    }
    *ppArchive = NULL;
    *plArchiveSize = 0;
    if(sEntryCount > 0)
    {
        pOffsets = (uint32_t *)calloc(sEntryCount, sizeof(*pOffsets));
        if(pOffsets == NULL)
        {
            SetError(pError, lErrorSize, "out of memory");
            return 0;
        }
    }

    for(i = 0; i < sEntryCount; i++)
    {
        size_t lNameLength;
        uint32_t lCrc;

        if(pEntries[i].pName == NULL ||
           (pEntries[i].lSize > 0 && pEntries[i].pBytes == NULL))
        {
            SetError(pError, lErrorSize, "invalid entry data");
            goto fail;
        }
        lNameLength = strlen(pEntries[i].pName);
        if(!ValidateName(pEntries[i].pName, lNameLength))
        {
            SetError(pError, lErrorSize, "unsafe or invalid entry path");
            goto fail;
        }
        if(DuplicateName(pEntries, i, pEntries[i].pName, lNameLength))
        {
            SetError(pError, lErrorSize, "duplicate entry path");
            goto fail;
        }
        if(tArchive.lSize > UINT32_MAX)
        {
            SetError(pError, lErrorSize, "archive is too large");
            goto fail;
        }
        pOffsets[i] = (uint32_t)tArchive.lSize;
        lCrc = A8E_LibraryArchive_Crc32(pEntries[i].pBytes, pEntries[i].lSize);
        if(!BufferAppendU32(&tArchive, ZIP_LOCAL_SIGNATURE) ||
           !BufferAppendU16(&tArchive, 10) ||
           !BufferAppendU16(&tArchive, ZIP_UTF8_FLAG) ||
           !BufferAppendU16(&tArchive, 0) ||
           !BufferAppendU16(&tArchive, 0) ||
           !BufferAppendU16(&tArchive, 0) ||
           !BufferAppendU32(&tArchive, lCrc) ||
           !BufferAppendU32(&tArchive, pEntries[i].lSize) ||
           !BufferAppendU32(&tArchive, pEntries[i].lSize) ||
           !BufferAppendU16(&tArchive, (uint16_t)lNameLength) ||
           !BufferAppendU16(&tArchive, 0) ||
           !BufferAppend(&tArchive, pEntries[i].pName, lNameLength) ||
           !BufferAppend(&tArchive, pEntries[i].pBytes, pEntries[i].lSize))
        {
            SetError(pError, lErrorSize, "out of memory");
            goto fail;
        }
    }

    {
        size_t lCentralOffset = tArchive.lSize;
        uint32_t lCentralSize;
        if(lCentralOffset > UINT32_MAX)
        {
            SetError(pError, lErrorSize, "archive is too large");
            goto fail;
        }
        for(i = 0; i < sEntryCount; i++)
        {
            size_t lNameLength = strlen(pEntries[i].pName);
            uint32_t lCrc = A8E_LibraryArchive_Crc32(pEntries[i].pBytes, pEntries[i].lSize);
            if(!BufferAppendU32(&tArchive, ZIP_CENTRAL_SIGNATURE) ||
               !BufferAppendU16(&tArchive, 20) ||
               !BufferAppendU16(&tArchive, 10) ||
               !BufferAppendU16(&tArchive, ZIP_UTF8_FLAG) ||
               !BufferAppendU16(&tArchive, 0) ||
               !BufferAppendU16(&tArchive, 0) ||
               !BufferAppendU16(&tArchive, 0) ||
               !BufferAppendU32(&tArchive, lCrc) ||
               !BufferAppendU32(&tArchive, pEntries[i].lSize) ||
               !BufferAppendU32(&tArchive, pEntries[i].lSize) ||
               !BufferAppendU16(&tArchive, (uint16_t)lNameLength) ||
               !BufferAppendU16(&tArchive, 0) ||
               !BufferAppendU16(&tArchive, 0) ||
               !BufferAppendU16(&tArchive, 0) ||
               !BufferAppendU16(&tArchive, 0) ||
               !BufferAppendU32(&tArchive, 0) ||
               !BufferAppendU32(&tArchive, pOffsets[i]) ||
               !BufferAppend(&tArchive, pEntries[i].pName, lNameLength))
            {
                SetError(pError, lErrorSize, "out of memory");
                goto fail;
            }
        }
        if(tArchive.lSize < lCentralOffset ||
           tArchive.lSize - lCentralOffset > UINT32_MAX ||
           tArchive.lSize > UINT32_MAX - 22u)
        {
            SetError(pError, lErrorSize, "archive is too large");
            goto fail;
        }
        lCentralSize = (uint32_t)(tArchive.lSize - lCentralOffset);
        if(!BufferAppendU32(&tArchive, ZIP_END_SIGNATURE) ||
           !BufferAppendU16(&tArchive, 0) ||
           !BufferAppendU16(&tArchive, 0) ||
           !BufferAppendU16(&tArchive, sEntryCount) ||
           !BufferAppendU16(&tArchive, sEntryCount) ||
           !BufferAppendU32(&tArchive, lCentralSize) ||
           !BufferAppendU32(&tArchive, (uint32_t)lCentralOffset) ||
           !BufferAppendU16(&tArchive, 0))
        {
            SetError(pError, lErrorSize, "out of memory");
            goto fail;
        }
    }

    if(tArchive.lSize > UINT32_MAX)
    {
        SetError(pError, lErrorSize, "archive is too large");
        goto fail;
    }
    *ppArchive = tArchive.pData;
    *plArchiveSize = (uint32_t)tArchive.lSize;
    free(pOffsets);
    return 1;

fail:
    free(pOffsets);
    free(tArchive.pData);
    return 0;
}

static void FreePartialEntries(A8E_LibraryArchiveEntry_t *pEntries, uint16_t sCount)
{
    uint16_t i;
    if(pEntries == NULL)
    {
        return;
    }
    for(i = 0; i < sCount; i++)
    {
        free(pEntries[i].pName);
        free(pEntries[i].pBytes);
    }
    free(pEntries);
}

int A8E_LibraryArchive_Read(
    const uint8_t *pArchive,
    uint32_t lArchiveSize,
    A8E_LibraryArchiveEntry_t **ppEntries,
    uint16_t *psEntryCount,
    char *pError,
    size_t lErrorSize)
{
    size_t lSearchStart;
    size_t lEndOffset = SIZE_MAX;
    size_t lCentralOffset;
    size_t lCentralSize;
    size_t lOffset;
    uint16_t sEntryCount;
    uint16_t i;
    A8E_LibraryArchiveEntry_t *pEntries = NULL;

    if(pArchive == NULL || ppEntries == NULL || psEntryCount == NULL)
    {
        SetError(pError, lErrorSize, "invalid input arguments");
        return 0;
    }
    *ppEntries = NULL;
    *psEntryCount = 0;
    if(lArchiveSize < 22)
    {
        SetError(pError, lErrorSize, "archive is too small");
        return 0;
    }

    lSearchStart = lArchiveSize > 0xffffu + 22u ?
        (size_t)lArchiveSize - 0xffffu - 22u : 0;
    lOffset = (size_t)lArchiveSize - 22;
    for(;;)
    {
        if(ReadU32(pArchive + lOffset) == ZIP_END_SIGNATURE &&
           (size_t)ReadU16(pArchive + lOffset + 20) + lOffset + 22 == lArchiveSize)
        {
            lEndOffset = lOffset;
            break;
        }
        if(lOffset == lSearchStart)
        {
            break;
        }
        lOffset--;
    }
    if(lEndOffset == SIZE_MAX)
    {
        SetError(pError, lErrorSize, "end record not found");
        return 0;
    }
    if(ReadU16(pArchive + lEndOffset + 4) != 0 || ReadU16(pArchive + lEndOffset + 6) != 0)
    {
        SetError(pError, lErrorSize, "multi-disk archive is unsupported");
        return 0;
    }
    sEntryCount = ReadU16(pArchive + lEndOffset + 10);
    if(ReadU16(pArchive + lEndOffset + 8) != sEntryCount)
    {
        SetError(pError, lErrorSize, "entry count mismatch");
        return 0;
    }
    lCentralSize = ReadU32(pArchive + lEndOffset + 12);
    lCentralOffset = ReadU32(pArchive + lEndOffset + 16);
    if(!HasRange(lCentralOffset, lCentralSize, lArchiveSize) ||
       lCentralOffset + lCentralSize > lEndOffset)
    {
        SetError(pError, lErrorSize, "central directory is out of range");
        return 0;
    }
    if(sEntryCount > 0)
    {
        pEntries = (A8E_LibraryArchiveEntry_t *)calloc(sEntryCount, sizeof(*pEntries));
        if(pEntries == NULL)
        {
            SetError(pError, lErrorSize, "out of memory");
            return 0;
        }
    }

    lOffset = lCentralOffset;
    for(i = 0; i < sEntryCount; i++)
    {
        const uint8_t *pCentral;
        const uint8_t *pName;
        size_t lNameLength;
        size_t lExtraLength;
        size_t lCommentLength;
        size_t lEntryLength;
        uint32_t lCompressedSize;
        uint32_t lSize;
        uint32_t lLocalOffset;
        size_t lDataOffset;
        const uint8_t *pLocal;

        if(!HasRange(lOffset, 46, lArchiveSize) || ReadU32(pArchive + lOffset) != ZIP_CENTRAL_SIGNATURE)
        {
            SetError(pError, lErrorSize, "invalid central directory entry");
            goto read_fail;
        }
        pCentral = pArchive + lOffset;
        if((ReadU16(pCentral + 8) & (1u | 8u)) != 0 || ReadU16(pCentral + 10) != 0)
        {
            SetError(pError, lErrorSize, "encrypted, descriptor-based, or compressed entries are unsupported");
            goto read_fail;
        }
        lNameLength = ReadU16(pCentral + 28);
        lExtraLength = ReadU16(pCentral + 30);
        lCommentLength = ReadU16(pCentral + 32);
        lEntryLength = 46 + lNameLength + lExtraLength + lCommentLength;
        if(!HasRange(lOffset, lEntryLength, lArchiveSize))
        {
            SetError(pError, lErrorSize, "truncated central directory entry");
            goto read_fail;
        }
        pName = pCentral + 46;
        if(!ValidateName((const char *)pName, lNameLength))
        {
            SetError(pError, lErrorSize, "unsafe or invalid entry path");
            goto read_fail;
        }
        if(i > 0)
        {
            uint16_t j;
            for(j = 0; j < i; j++)
            {
                if(strlen(pEntries[j].pName) == lNameLength &&
                   memcmp(pEntries[j].pName, pName, lNameLength) == 0)
                {
                    SetError(pError, lErrorSize, "duplicate entry path");
                    goto read_fail;
                }
            }
        }
        lCompressedSize = ReadU32(pCentral + 20);
        lSize = ReadU32(pCentral + 24);
        lLocalOffset = ReadU32(pCentral + 42);
        if(lCompressedSize != lSize || !HasRange(lLocalOffset, 30, lArchiveSize))
        {
            SetError(pError, lErrorSize, "invalid entry size or local offset");
            goto read_fail;
        }
        pLocal = pArchive + lLocalOffset;
        if(ReadU32(pLocal) != ZIP_LOCAL_SIGNATURE ||
           ReadU16(pLocal + 6) != ReadU16(pCentral + 8) ||
           ReadU16(pLocal + 8) != ReadU16(pCentral + 10) ||
           ReadU16(pLocal + 26) != lNameLength ||
           !HasRange(lLocalOffset, 30 + lNameLength + ReadU16(pLocal + 28), lArchiveSize) ||
           memcmp(pLocal + 30, pName, lNameLength) != 0)
        {
            SetError(pError, lErrorSize, "local file header does not match central directory");
            goto read_fail;
        }
        lDataOffset = lLocalOffset + 30 + lNameLength + ReadU16(pLocal + 28);
        if(!HasRange(lDataOffset, lSize, lArchiveSize))
        {
            SetError(pError, lErrorSize, "truncated file data");
            goto read_fail;
        }
        pEntries[i].pName = (char *)malloc(lNameLength + 1);
        if(pEntries[i].pName == NULL)
        {
            SetError(pError, lErrorSize, "out of memory");
            goto read_fail;
        }
        memcpy(pEntries[i].pName, pName, lNameLength);
        pEntries[i].pName[lNameLength] = '\0';
        if(lSize > 0)
        {
            pEntries[i].pBytes = (uint8_t *)malloc(lSize);
            if(pEntries[i].pBytes == NULL)
            {
                SetError(pError, lErrorSize, "out of memory");
                goto read_fail;
            }
            memcpy(pEntries[i].pBytes, pArchive + lDataOffset, lSize);
        }
        pEntries[i].lSize = lSize;
        if(A8E_LibraryArchive_Crc32(pEntries[i].pBytes, lSize) != ReadU32(pCentral + 16))
        {
            SetError(pError, lErrorSize, "CRC-32 mismatch");
            goto read_fail;
        }
        lOffset += lEntryLength;
    }
    if(lOffset != lCentralOffset + lCentralSize)
    {
        SetError(pError, lErrorSize, "central directory size mismatch");
        goto read_fail;
    }
    *ppEntries = pEntries;
    *psEntryCount = sEntryCount;
    return 1;

read_fail:
    FreePartialEntries(pEntries, sEntryCount);
    return 0;
}

void A8E_LibraryArchive_FreeEntries(
    A8E_LibraryArchiveEntry_t *pEntries,
    uint16_t sEntryCount)
{
    FreePartialEntries(pEntries, sEntryCount);
}
