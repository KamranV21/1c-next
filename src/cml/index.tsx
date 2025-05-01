import { Endpoint, PayloadRequest } from 'payload'

const FILE_LIMIT = 50000

type CMLResponse = 'SUCCESS' | 'FAILURE' | 'PROGRESS' | 'ZIP=YES'

function generateResponse(response: CMLResponse, message: string = '') {
  return new Response(`${response}\n${message}`)
}

async function getEndpoint(req: PayloadRequest) {
  const mode = req.searchParams.get('mode')

  switch (mode) {
    case 'init':
      return generateResponse('ZIP=YES', `file_limit=${FILE_LIMIT}`)
    case 'checkauth':
      const token = await authenticateUser(req)
      if (token) {
        return generateResponse('SUCCESS', token)
      }
      return generateResponse('FAILURE', 'Invalid credentials')
    case 'import':
      return generateResponse('SUCCESS')
    default:
      return generateResponse('FAILURE', 'Invalid mode')
  }
}

async function authenticateUser(req: PayloadRequest) {
  const [email, password] = authCredentialsFromHeader(req.headers.get('authorization') || '')

  try {
    const data = await req.payload.login({
      collection: 'users',
      data: {
        email,
        password,
      },
    })

    if (data) return data.token
  } catch (error) {
    console.log(error)
  }

  return ''
}

function authCredentialsFromHeader(header: string) {
  const encodedCredentials = header.split(' ')[1]
  const decodedCredentials = Buffer.from(encodedCredentials, 'base64').toString('utf-8')
  return decodedCredentials.split(':')
}

export const cmlEndpoints: Endpoint[] = [
  {
    path: '/commerceml',
    method: 'get',
    handler: getEndpoint,
  },
]
