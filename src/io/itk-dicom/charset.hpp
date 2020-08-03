#include <string>
#include <vector>

class CharStringToUTF8Converter {
public:
  // See: setSpecificCharacterSet(const char *)
  CharStringToUTF8Converter(const std::string &spcharsets);
  CharStringToUTF8Converter(const char *spcharsets);

  /**
   * Input must be the DICOM SpecificCharacterSet element value.
   * See:
   * http://dicom.nema.org/medical/dicom/current/output/html/part03.html#sect_C.12.1.1.2
   */
  void setSpecificCharacterSet(const char *spcharsets);

  std::string convertCharStringToUTF8(const std::string &str);
  std::string convertCharStringToUTF8(const char *str, size_t len);

  bool getHandlePatientName() { return this->handlePatientName; }

  void setHandlePatientName(bool yn) { this->handlePatientName = yn; }

private:
  std::vector<std::string> m_charsets;
  bool handlePatientName;
};
