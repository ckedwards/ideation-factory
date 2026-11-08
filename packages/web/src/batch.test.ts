/// <reference types="bun" />
import { expect, test } from 'bun:test'
import { batched } from './batch.ts'

type Person = { id: string; name: string }

function setup(known: string[]) {
  const requests: string[][] = []
  const load = batched<Person>(
    async (ids) => {
      requests.push(ids)
      return ids.filter((id) => known.includes(id)).map((id) => ({ id, name: id.toUpperCase() }))
    },
    (p) => p.id,
    { max: 3 },
  )
  return { load, requests }
}

test('everything asked for at once goes in one request, each caller getting its own', async () => {
  const { load, requests } = setup(['a', 'b', 'c'])
  const [a, b, again] = await Promise.all([load('a'), load('b'), load('a')])
  expect([a.name, b.name, again.name]).toEqual(['A', 'B', 'A'])
  expect(requests).toEqual([['a', 'b']])
})

test('more than fit in one request go in several', async () => {
  const { load, requests } = setup(['a', 'b', 'c', 'd', 'e'])
  await Promise.all(['a', 'b', 'c', 'd', 'e'].map(load))
  expect(requests).toEqual([
    ['a', 'b', 'c'],
    ['d', 'e'],
  ])
})

test('someone not found fails alone; asking later is a new request', async () => {
  const { load, requests } = setup(['a'])
  const [found, missing] = await Promise.allSettled([load('a'), load('zed')])
  expect(found).toMatchObject({ status: 'fulfilled', value: { name: 'A' } })
  expect(missing).toMatchObject({ status: 'rejected' })
  await load('a')
  expect(requests).toHaveLength(2)
})
