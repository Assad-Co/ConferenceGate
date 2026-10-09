from pathlib import Path

p = Path('server/braveSearch.ts')
text = p.read_text()
old = '''      const sameYear = requestedYear
        ? exactTitleCandidates.find((candidate) => {
            const candidateYear = yearOf(candidate);
            return candidateYear === null || candidateYear === requestedYear;
          })
        : null;
      const match = sameYear || exactTitleCandidates[0] || null;'''
new = '''      const sameYear = requestedYear
        ? exactTitleCandidates.find((candidate) => {
            const candidateYear = yearOf(candidate);
            return candidateYear === null || candidateYear === requestedYear;
          })
        : null;
      // If the history entry names a year, never attach a stored edition that explicitly states
      // another year. An undated candidate may still match because it does not contradict the
      // profile; a dated 2027 record must not enrich a 2024 history entry.
      const match = requestedYear ? (sameYear || null) : (exactTitleCandidates[0] || null);'''
if text.count(old) != 1:
    raise RuntimeError(f'expected one year-match block, found {text.count(old)}')
p.write_text(text.replace(old, new, 1))
print('Phase 52 strict edition-year matching added')
