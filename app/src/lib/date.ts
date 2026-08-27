/** 以设备本地时区生成 yyyy-mm-dd，避免中国时区凌晨被 UTC 算作前一天。 */
export function localDateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
