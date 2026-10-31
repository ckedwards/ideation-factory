import { fileStoreContract } from './contract.ts'
import { MemoryFileStore } from './memory.ts'

fileStoreContract('MemoryFileStore', async () => new MemoryFileStore())
