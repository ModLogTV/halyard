/** Saves `text` as a file through a temporary object URL. Browser only. */
export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Revoke after the browser started the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
