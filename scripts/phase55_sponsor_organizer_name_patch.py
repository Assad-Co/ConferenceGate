from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Expected snippet not found in {path}:\n{old[:400]}')
    p.write_text(text.replace(old, new, 1))

replace_once(
    'src/api/sponsors.ts',
    """  organizerId: string;\n  title: string;""",
    """  organizerId: string;\n  organizerName?: string;\n  title: string;""",
)

replace_once(
    'server/sponsors.ts',
    """function toSponsorshipNeedDTO(\n  row: SponsorshipNeedRow,\n  match?: number | SponsorNeedMatchDetail\n) {""",
    """function toSponsorshipNeedDTO(\n  row: SponsorshipNeedRow,\n  match?: number | SponsorNeedMatchDetail,\n  organizerName = \"\"\n) {""",
)

replace_once(
    'server/sponsors.ts',
    """    organizerId: row.organizer_id,\n    title: row.title,""",
    """    organizerId: row.organizer_id,\n    organizerName,\n    title: row.title,""",
)

replace_once(
    'server/sponsors.ts',
    """    const rows = await dbAll<SponsorshipNeedRow>(\n      `SELECT * FROM sponsorship_needs\n        WHERE status='active' AND (deadline IS NULL OR deadline='' OR date(deadline)>=date('now'))\n        ORDER BY created_at DESC`\n    );""",
    """    const rows = await dbAll<any>(\n      `SELECT n.*, u.name as organizer_name, u.organization as organizer_organization\n         FROM sponsorship_needs n\n         JOIN users u ON u.id=n.organizer_id\n        WHERE n.status='active' AND (n.deadline IS NULL OR n.deadline='' OR date(n.deadline)>=date('now'))\n        ORDER BY n.created_at DESC`\n    );""",
)

replace_once(
    'server/sponsors.ts',
    """    res.json({ needs: ranked.map(({ row, match }) => toSponsorshipNeedDTO(row, match)) });""",
    """    res.json({\n      needs: ranked.map(({ row, match }) =>\n        toSponsorshipNeedDTO(row, match, row.organizer_organization || row.organizer_name || \"Organizer\")\n      ),\n    });""",
)

replace_once(
    'src/components/SponsorPortal.tsx',
    """      need.title, need.conferenceTitle, need.description, need.deadline,""",
    """      need.title, need.conferenceTitle, need.organizerName, need.description, need.deadline,""",
)

replace_once(
    'src/components/SponsorPortal.tsx',
    """                          <p className=\"text-xs text-slate-500\">{need.conferenceTitle}</p>""",
    """                          <p className=\"text-xs text-slate-500\">{[need.organizerName, need.conferenceTitle].filter(Boolean).join(' · ')}</p>""",
)

print('Phase 55 organizer identity patch applied')
