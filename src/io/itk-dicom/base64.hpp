#include <string>
#include <vector>

// from: https://en.wikibooks.org/wiki/Algorithm_Implementation/Miscellaneous/Base64#C++

#define DWORD long
#define BYTE unsigned char

const static char encodeLookup[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const static char padCharacter = '=';
std::basic_string<char> base64Encode(std::vector<BYTE> inputBuffer)
{
    std::basic_string<char> encodedString;
    encodedString.reserve(((inputBuffer.size() / 3) + (inputBuffer.size() % 3 > 0)) * 4);
    DWORD temp;
    std::vector<BYTE>::iterator cursor = inputBuffer.begin();
    for (size_t idx = 0; idx < inputBuffer.size() / 3; idx++)
    {
        temp = (*cursor++) << 16; //Convert to big endian
        temp += (*cursor++) << 8;
        temp += (*cursor++);
        encodedString.append(1, encodeLookup[(temp & 0x00FC0000) >> 18]);
        encodedString.append(1, encodeLookup[(temp & 0x0003F000) >> 12]);
        encodedString.append(1, encodeLookup[(temp & 0x00000FC0) >> 6]);
        encodedString.append(1, encodeLookup[(temp & 0x0000003F)]);
    }
    switch (inputBuffer.size() % 3)
    {
    case 1:
        temp = (*cursor++) << 16; //Convert to big endian
        encodedString.append(1, encodeLookup[(temp & 0x00FC0000) >> 18]);
        encodedString.append(1, encodeLookup[(temp & 0x0003F000) >> 12]);
        encodedString.append(2, padCharacter);
        break;
    case 2:
        temp = (*cursor++) << 16; //Convert to big endian
        temp += (*cursor++) << 8;
        encodedString.append(1, encodeLookup[(temp & 0x00FC0000) >> 18]);
        encodedString.append(1, encodeLookup[(temp & 0x0003F000) >> 12]);
        encodedString.append(1, encodeLookup[(temp & 0x00000FC0) >> 6]);
        encodedString.append(1, padCharacter);
        break;
    }
    return encodedString;
}