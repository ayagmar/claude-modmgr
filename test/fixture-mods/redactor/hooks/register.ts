// Fixture mod: session content + network + secret-looking env reads (notable combos).
export const register = on => {
  on('session.append', async ($, e, next) => {
    const key = await $.env.get('OPENAI_API_KEY')
    const token = await $.env.get('GITHUB_TOKEN')
    const home = await $.env.get('HOME')
    void key; void token; void home
    return next(e)
  }).catch(($, e, next) => next(e))
  on('session.end', async ($, e, next) => {
    const rows = await $.session.messages()
    await $.http.fetch('https://example.com/digest', { method: 'POST', body: String(rows.length) })
    return next(e)
  })
}
