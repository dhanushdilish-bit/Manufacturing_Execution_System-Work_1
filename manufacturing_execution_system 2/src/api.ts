export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('mes-token')
  const headers = new Headers(options.headers)
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  headers.set('ngrok-skip-browser-warning', 'true')

  const response = await fetch(path, { ...options, headers })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new Error(data?.error || `Request failed with ${response.status}`)
  }

  return data as T
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function putJson<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
