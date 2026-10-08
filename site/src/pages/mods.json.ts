// mods.json: every mod in the community index as rows (lib/search.ts `Row`),
// fetched by the page's search after it loads.
import { modsData } from '../lib/mods.ts'

export const GET = async (): Promise<Response> =>
  new Response(JSON.stringify(await modsData()), {
    headers: { 'Content-Type': 'application/json' },
  })
