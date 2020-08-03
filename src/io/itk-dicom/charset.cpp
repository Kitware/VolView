#include <iostream>

#include <algorithm>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string.h>
#include <string>
#include <vector>

#include <iconv.h>

#include "charset.hpp"

const std::string DEFAULT_ENCODING("ISO_IR 6");
const char *ASCII = "ASCII";

// If not found, then pos == len
size_t findEsc(const char *str, size_t len, size_t pos = 0) {
  while (pos < len && str[pos] != 0x1b) {
    ++pos;
  }
  return pos;
}

const char *definedTermToIconvCharset(const std::string &defTerm) {
  // be strict about comparing defined terms, so no fancy parsing
  // that could possibly make these operations faster.
  // See:
  // http://dicom.nema.org/medical/dicom/current/output/chtml/part02/sect_D.6.2.html
  if (defTerm == "ISO_IR 6" || defTerm == "ISO 2022 IR 6") {
    return ASCII;
  }
  if (defTerm == "ISO_IR 100" || defTerm == "ISO 2022 IR 100") {
    return "ISO-8859-1"; // Latin 1
  }
  if (defTerm == "ISO_IR 101" || defTerm == "ISO 2022 IR 101") {
    return "ISO-8859-2"; // Latin 2
  }
  if (defTerm == "ISO_IR 109" || defTerm == "ISO 2022 IR 109") {
    return "ISO-8859-3"; // Latin 3
  }
  if (defTerm == "ISO_IR 110" || defTerm == "ISO 2022 IR 110") {
    return "ISO-8859-4"; // Latin 4
  }
  if (defTerm == "ISO_IR 144" || defTerm == "ISO 2022 IR 144") {
    return "ISO-8859-5"; // Cyrillic
  }
  if (defTerm == "ISO_IR 127" || defTerm == "ISO 2022 IR 127") {
    return "ISO-8859-6"; // Arabic
  }
  if (defTerm == "ISO_IR 126" || defTerm == "ISO 2022 IR 126") {
    return "ISO-8859-7"; // Greek
  }
  if (defTerm == "ISO_IR 138" || defTerm == "ISO 2022 IR 138") {
    return "ISO-8859-8"; // Hebrew
  }
  if (defTerm == "ISO_IR 148" || defTerm == "ISO 2022 IR 148") {
    return "ISO-8859-9"; // Latin 5, Turkish
  }
  if (defTerm == "ISO_IR 13" || defTerm == "ISO 2022 IR 13") {
    // while technically not strict, SHIFT_JIS succeeds JIS X 0201
    // See: https://en.wikipedia.org/wiki/JIS_X_0201
    return "SHIFT_JIS"; // Japanese
  }
  if (defTerm == "ISO_IR 166" || defTerm == "ISO 2022 IR 166") {
    return "TIS-620"; // Thai
  }
  if (defTerm == "ISO 2022 IR 87") {
    // see: https://en.wikipedia.org/wiki/JIS_X_0208
    return "ISO-2022-JP"; // Japanese
  }
  if (defTerm == "ISO 2022 IR 159") {
    // see: https://en.wikipedia.org/wiki/JIS_X_0212
    return "ISO-2022-JP-1"; // Japanese
  }
  if (defTerm == "ISO 2022 IR 149") {
    return "EUC-KR"; // Korean
  }
  if (defTerm == "ISO 2022 IR 58") {
    return "EUC-CN"; // Chinese
  }
  if (defTerm == "ISO_IR 192") {
    return "UTF-8";
  }
  if (defTerm == "GB18030") {
    return "GB18030";
  }
  if (defTerm == "GBK") {
    return "GBK";
  }
  return nullptr;
}

// seq should be the sequence after the ESC char
// return value should match in definedTermToIconvCharset
const char *iso2022EscSelectCharset(const char *seq) {
  if (seq[0] == '(' && seq[1] == 'B') {
    return "ISO 2022 IR 6";
  }
  if (seq[0] == '-' && seq[1] == 'A') {
    return "ISO 2022 IR 100";
  }
  if (seq[0] == '-' && seq[1] == 'B') {
    return "ISO 2022 IR 101";
  }
  if (seq[0] == '-' && seq[1] == 'C') {
    return "ISO 2022 IR 109";
  }
  if (seq[0] == '-' && seq[1] == 'D') {
    return "ISO 2022 IR 110";
  }
  if (seq[0] == '-' && seq[1] == 'L') {
    return "ISO 2022 IR 144";
  }
  if (seq[0] == '-' && seq[1] == 'G') {
    return "ISO 2022 IR 127";
  }
  if (seq[0] == '-' && seq[1] == 'F') {
    return "ISO 2022 IR 126";
  }
  if (seq[0] == '-' && seq[1] == 'H') {
    return "ISO 2022 IR 138";
  }
  if (seq[0] == '-' && seq[1] == 'M') {
    return "ISO 2022 IR 148";
  }
  // technically 'J' corresponds to IR 14, byt SHIFT_JIS should still work
  if (seq[0] == '-' && (seq[1] == 'I' || seq[1] == 'J')) {
    return "ISO 2022 IR 13";
  }
  if (seq[0] == '-' && seq[1] == 'T') {
    return "ISO 2022 IR 166";
  }
  if (seq[0] == '$' && seq[1] == 'B') {
    return "ISO 2022 IR 87";
  }
  if (seq[0] == '$' && seq[1] == '(' && seq[2] == 'D') {
    return "ISO 2022 IR 159";
  }
  if (seq[0] == '$' && seq[1] == ')' && seq[2] == 'C') {
    return "ISO 2022 IR 149";
  }
  if (seq[0] == '$' && seq[1] == ')' && seq[2] == 'A') {
    return "ISO 2022 IR 58";
  }
  return "";
}

// seq should point after the ESC char. Returned length will
// not include ESC char.
size_t iso2022EscSeqLength(const char *seq) {
  if (seq[0] == '$' && seq[1] >= '(' && seq[1] <= '/') {
    return 3;
  }
  return 2;
}

CharStringToUTF8Converter::CharStringToUTF8Converter(
    const std::string &spcharsets) {
  this->setSpecificCharacterSet(spcharsets.c_str());
}

CharStringToUTF8Converter::CharStringToUTF8Converter(const char *spcharsets) {
  this->setSpecificCharacterSet(spcharsets);
}

void CharStringToUTF8Converter::setSpecificCharacterSet(
    const char *spcharsets) {
  std::string specificCharacterSet(spcharsets);
  std::string token;
  std::istringstream tokStream(specificCharacterSet);

  m_charsets.clear();

  int count = 0;
  while (std::getline(tokStream, token, '\\')) {
    // case: first element is empty. Use default ISO-IR 6 encoding.
    if (token.size() == 0 && count == 0) {
      m_charsets.push_back(DEFAULT_ENCODING);
      // case: no duplicates
    } else if (m_charsets.end() ==
               std::find(m_charsets.begin(), m_charsets.end(), token)) {
      const char *chname = definedTermToIconvCharset(token);
      // ISO_IR 6 isn't a formally recognized defined term.
      if (chname != nullptr && chname != ASCII) {
        m_charsets.push_back(token);
      }
    } else {
      std::cerr << "WARN: Found duplicate charset '" + token + "'; ignoring"
                << std::endl;
    }
    ++count;
  }

  if (count == 0) {
    // use default encoding
    m_charsets.push_back(DEFAULT_ENCODING);
  }
}

std::string
CharStringToUTF8Converter::convertCharStringToUTF8(const std::string &str) {
  size_t len = str.size();
  return this->convertCharStringToUTF8(str.c_str(), len);
}

std::string CharStringToUTF8Converter::convertCharStringToUTF8(const char *str,
                                                               size_t len) {
  // m_charsets must always have at least 1 element prior to calling
  const char *initialCharset = definedTermToIconvCharset(m_charsets[0]);
  if (initialCharset == nullptr) {
    return {};
  }

  iconv_t cd = iconv_open("UTF-8", initialCharset);
  if (cd == (iconv_t)-1) {
    return {};
  }

  int utf8len = len * 4;
  std::unique_ptr<char[]> result(
      new char[utf8len]); // UTF8 will have max length of utf8len

  // make a copy because iconv requires a char *
  char *copiedStr = (char *)malloc(len + 1); // include null terminator
  strncpy(copiedStr, str, len + 1);

  char *inbuf = copiedStr;
  char *outbuf = result.get();
  size_t inbytesleft = len;
  size_t outbytesleft = utf8len;

  char test[len];

  // special case: only one charset, so assume string is just that charset.
  if (m_charsets.size() == 1) {
    iconv(cd, &inbuf, &inbytesleft, &outbuf, &outbytesleft);
  } else {
    size_t fragmentStart = 0;
    size_t fragmentEnd = 0;

    while (fragmentStart < len) {
      // fragmentEnd will always be end of current fragment (exclusive end)
      fragmentEnd = findEsc(str, len, fragmentStart);
      inbuf = copiedStr + fragmentStart;
      inbytesleft = fragmentEnd - fragmentStart;

      iconv(cd, &inbuf, &inbytesleft, &outbuf, &outbytesleft);

      fragmentStart = fragmentEnd;
      // case: ISO 2022 escape encountered
      if (fragmentStart < len) {
        const char *escSeq = copiedStr + fragmentStart + 1;

        const char *nextTerm = iso2022EscSelectCharset(escSeq);
        const char *nextCharset =
            definedTermToIconvCharset(std::string(nextTerm));
        if (nextCharset == nullptr ||
            m_charsets.end() ==
                std::find(m_charsets.begin(), m_charsets.end(), nextTerm)) {
          break; // bail out
        }

        if (0 != iconv_close(cd)) {
          break; // bail out
        }
        cd = iconv_open("UTF-8", nextCharset);
        if (cd == (iconv_t)-1) {
          break; // bail out
        }

        fragmentStart += iso2022EscSeqLength(escSeq) + 1;
      }
    }
  }

  free(copiedStr);
  iconv_close(cd);

  // since result is filled with NULL bytes, string constructor will figure out
  // the correct string ending.
  return std::string(result.get());
}
