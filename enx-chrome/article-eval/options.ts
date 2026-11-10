import type { DatasetLoader } from '../src/lib/articleEval/dataset.ts'
import { WCXB_PAGE_TYPES } from '../src/lib/articleEval/dataset.ts'
import { WcxbDataset, WCXB_COMMIT } from './wcxb.ts'
import { ZyteDataset, ZYTE_COMMIT } from './zyte.ts'

const DATASETS: Record<
  string,
  () => { header: string; loader: DatasetLoader }
> = {
  zyte: () => ({
    header: `Dataset: zyte at ${ZYTE_COMMIT}; reference: human-labelled articleBody`,
    loader: new ZyteDataset(),
  }),
  wcxb: () => ({
    header:
      `Dataset: wcxb at ${WCXB_COMMIT}; reference: ground_truth.main_content ` +
      `(LLM-drafted, human-reviewed); page types: ${WCXB_PAGE_TYPES.join(', ')}`,
    loader: new WcxbDataset(),
  }),
}

export function parseArgs(args: string[]) {
  const options = {
    updateBaseline: false,
    headed: false,
    only: '',
    dataset: '',
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--update-baseline') options.updateBaseline = true
    else if (args[i] === '--headed') options.headed = true
    else if (args[i] === '--dataset' && args[i + 1]) options.dataset = args[++i]
    else if (args[i] === '--only' && args[i + 1]) options.only = args[++i]
    else throw new Error(`unknown argument: ${args[i]}`)
  }
  if (options.dataset && !Object.hasOwn(DATASETS, options.dataset))
    throw new Error(`unknown dataset: ${options.dataset}`)
  if (options.dataset && options.updateBaseline)
    throw new Error('--update-baseline is only supported for the online corpus')
  return options
}

/** The loader for a dataset name `parseArgs` accepted, and its run header. */
export function selectDataset(name: string): {
  header: string
  loader: DatasetLoader
} {
  return DATASETS[name]()
}
