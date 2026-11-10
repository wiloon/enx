import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseArgs, selectDataset } from '../../article-eval/options.ts'
import { WcxbDataset, WCXB_COMMIT } from '../../article-eval/wcxb.ts'
import { ZyteDataset, ZYTE_COMMIT } from '../../article-eval/zyte.ts'

test('selects the Zyte loader with its existing header', () => {
  const { dataset } = parseArgs(['--dataset', 'zyte'])
  const selected = selectDataset(dataset)
  assert.ok(selected.loader instanceof ZyteDataset)
  assert.equal(
    selected.header,
    `Dataset: zyte at ${ZYTE_COMMIT}; reference: human-labelled articleBody`
  )
})

test('selects the WCXB loader and names its commit and label source', () => {
  const { dataset } = parseArgs(['--dataset', 'wcxb', '--only', 'docs'])
  const selected = selectDataset(dataset)
  assert.ok(selected.loader instanceof WcxbDataset)
  assert.equal(
    selected.header,
    `Dataset: wcxb at ${WCXB_COMMIT}; reference: ground_truth.main_content ` +
      '(LLM-drafted, human-reviewed); page types: article, documentation'
  )
})

test('rejects an unknown dataset and a baseline update with a dataset', () => {
  assert.throws(() => parseArgs(['--dataset', 'wceb']), /unknown dataset: wceb/)
  assert.throws(
    () => parseArgs(['--dataset', 'wcxb', '--update-baseline']),
    /--update-baseline is only supported for the online corpus/
  )
})
