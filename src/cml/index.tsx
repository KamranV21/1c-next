import { BasePayload, Endpoint, PayloadRequest, TaskConfig } from 'payload'
import { Media } from '@/payload-types'
import { promises as fs } from 'fs'
import { Readable } from 'stream'
import { CMLResponse } from './types'

const FILE_LIMIT = 100000
const QUEUE_NAME = 'cml-queue'

export const cmlEndpoints: Endpoint[] = [
  {
    path: '/commerceml',
    method: 'get',
    handler: getEndpoint,
  },
  {
    path: '/commerceml',
    method: 'post',
    handler: postEndpoint,
  },
]

export const cmlTask: TaskConfig = {
  slug: 'readCmlFile',
  inputSchema: [
    {
      name: 'fileId',
      type: 'number',
      required: true,
    },
  ],
  outputSchema: [
    {
      name: 'result',
      type: 'text',
      required: true,
    },
  ],
  handler: async ({ input }) => {
    console.log(`FILE ID: ${input.fileId}`)

    return {
      output: {
        result: 'SUCCESS',
      },
    }
  },
}

async function getEndpoint(req: PayloadRequest) {
  const mode = req.searchParams.get('mode')

  switch (mode) {
    case 'init':
      return generateResponse('ZIP=YES', `file_limit=${FILE_LIMIT}`)
    case 'checkauth':
      return await checkAuth(req)
    case 'import':
      await startQueueTask(req.payload)
      return generateResponse('SUCCESS')
    default:
      return generateResponse('FAILURE', 'Invalid mode')
  }
}

async function postEndpoint(req: PayloadRequest) {
  const mode = req.searchParams.get('mode')

  switch (mode) {
    case 'file':
      return await saveExchangeFile(req)
    default:
      return generateResponse('FAILURE', 'Invalid mode')
  }
}

async function saveExchangeFile(req: PayloadRequest) {
  const filename = req.searchParams.get('filename') || 'file'

  const nodeStream = Readable.from(req.body as any)

  try {
    const buffer = await streamToBuffer(nodeStream)

    const exsitingFile = await findExchangeFileByName(req.payload, filename)
    if (exsitingFile) {
      await updateExistingExchangeFile(req.payload, exsitingFile, buffer)
    } else {
      const newFile = await saveNewExchangeFile(req.payload, filename, buffer)
      await addJobToQueue(req.payload, newFile.id)
    }
  } catch (error) {
    console.log(error)
    return generateResponse('FAILURE', 'Server error')
  }

  return generateResponse('SUCCESS')
}

async function checkAuth(req: PayloadRequest) {
  try {
    const token = await authenticateUser(req)
    if (token) {
      return generateResponse('SUCCESS', token)
    }
    return generateResponse('FAILURE', 'Invalid credentials')
  } catch (error) {
    console.log(error)
    return generateResponse('FAILURE', 'Server error')
  }
}

async function authenticateUser(req: PayloadRequest) {
  const [email, password] = authCredentialsFromHeader(req.headers.get('authorization') || '')

  const data = await req.payload.login({
    collection: 'users',
    data: {
      email,
      password,
    },
  })

  return data.token
}

function authCredentialsFromHeader(header: string) {
  const encodedCredentials = header.split(' ')[1]
  const decodedCredentials = Buffer.from(encodedCredentials, 'base64').toString('utf-8')
  return decodedCredentials.split(':')
}

async function updateExistingExchangeFile(
  payload: BasePayload,
  existingFile: Media,
  bufferToAppend: Buffer,
) {
  const filepath = `${process.cwd()}/media/${existingFile.filename}`
  const existingBuffer = await fs.readFile(filepath)
  const combinedBuffer = Buffer.concat([existingBuffer, bufferToAppend])

  await payload.update({
    collection: 'media',
    id: existingFile.id,
    data: {},
    file: {
      data: combinedBuffer,
      name: existingFile.filename ?? '',
      mimetype: 'application/zip',
      size: combinedBuffer.length,
    },
  })
}

async function saveNewExchangeFile(payload: BasePayload, filename: string, buffer: Buffer) {
  return await payload.create({
    collection: 'media',
    data: {
      filename: filename,
      alt: filename,
    },
    file: {
      data: buffer,
      name: filename,
      mimetype: 'application/zip',
      size: buffer.length,
    },
  })
}

async function addJobToQueue(payload: BasePayload, fileId: number) {
  await payload.jobs.queue({
    queue: QUEUE_NAME,
    task: 'readCmlFile',
    input: {
      fileId,
    },
  })
}

async function startQueueTask(payload: BasePayload) {
  await payload.jobs.run({ queue: QUEUE_NAME, limit: 1 })
}

async function findExchangeFileByName(payload: BasePayload, filename: string) {
  const fileSerachResult = await payload.find({
    collection: 'media',
    where: {
      filename: {
        contains: filename.replace('.zip', ''),
      },
      mimeType: {
        equals: 'application/zip',
      },
    },
  })

  console.log(fileSerachResult)

  return fileSerachResult.docs.length > 0 ? fileSerachResult.docs[0] : null
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []

    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    stream.on('end', () => {
      resolve(Buffer.concat(chunks))
    })

    stream.on('error', (err) => {
      reject(err)
    })
  })
}

function generateResponse(response: CMLResponse, message: string = '') {
  return new Response(`${response}\n${message}`)
}
