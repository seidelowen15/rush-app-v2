export function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (j === 0 ? i : 0))
  )
  for (let j = 1; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
  return dp[m][n]
}

export function findMatches(raw, allRushees, checkedInIds) {
  const q = raw.toLowerCase().trim()
  if (q.length < 3) return []
  return allRushees
    .filter(r => !checkedInIds.has(r.id))
    .map(r => ({ ...r, dist: levenshtein(q, r.id), contains: r.id.includes(q) }))
    .filter(r => r.dist <= 2 || r.contains)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 4)
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

export function initials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const AVATAR_COLORS = [
  ['#e6f1fb', '#0c447c'],
  ['#eaf3de', '#27500a'],
  ['#eeedfe', '#3c3489'],
  ['#faeeda', '#633806'],
  ['#e1f5ee', '#085041'],
  ['#fbeaf0', '#72243e'],
]
export function avatarColor(id) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
