import fs from 'node:fs';

const path = 'src/components/ReviewerPortal.tsx';
let text = fs.readFileSync(path, 'utf8');

function replace(from, to, label) {
  if (!text.includes(from)) throw new Error(`missing patch marker: ${label}`);
  text = text.replace(from, to);
}

replace(
`  const [scores, setScores] = useState({
    technicalQuality: 8,
    originality: 9,
    relevance: 9,
    innovation: 8,
    methodology: 8,
    clarity: 9,
    scientificValue: 9,
    presentationPotential: 8,
  });`,
`  const [scores, setScores] = useState({
    technicalQuality: 0,
    originality: 0,
    relevance: 0,
    innovation: 0,
    methodology: 0,
    clarity: 0,
    scientificValue: 0,
    presentationPotential: 0,
  });`,
'neutral score defaults'
);

replace(
`  const [recommendation, setRecommendation] = useState<
    'Accept' | 'Accept with Revision' | 'Oral Presentation' | 'Poster Presentation' | 'Major Revision' | 'Reject'
  >('Oral Presentation');`,
`  const [recommendation, setRecommendation] = useState<
    '' | 'Accept' | 'Accept with Revision' | 'Oral Presentation' | 'Poster Presentation' | 'Major Revision' | 'Reject'
  >('');
  const scoringComplete = Object.values(scores).every((score) => score >= 1 && score <= 10);`,
'neutral recommendation default'
);

replace(
`  const handleEvaluateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentsToAuthor.trim()) return;`,
`  const handleEvaluateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentsToAuthor.trim() || !scoringComplete || !recommendation) return;`,
'evaluation completeness guard'
);

replace(
`      recommendation,`,
`      recommendation: recommendation as Exclude<typeof recommendation, ''>,`,
'recommendation payload narrowing'
);

replace(
`                      <span className="text-blue-700 font-extrabold">{(scores as any)[item.key]}/10</span>`,
`                      <span className="text-blue-700 font-extrabold">
                        {(scores as any)[item.key] > 0 ? String((scores as any)[item.key]) + '/10' : 'Not scored'}
                      </span>`,
'score label'
);

replace(
`                      min="1"`,
`                      min="0"`,
'slider unscored state'
);

replace(
`              <select
                value={recommendation}
                onChange={(e) => setRecommendation(e.target.value as any)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-xs font-bold text-slate-900"
              >
                <option value="Oral Presentation">Accept for Oral Presentation</option>`,
`              <select
                required
                value={recommendation}
                onChange={(e) => setRecommendation(e.target.value as any)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-xs font-bold text-slate-900"
              >
                <option value="" disabled>Select a recommendation…</option>
                <option value="Oral Presentation">Accept for Oral Presentation</option>`,
'recommendation placeholder'
);

replace(
`            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                className="px-6 py-3 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer flex items-center gap-2"
              >`,
`            <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-[10px] text-slate-500">
                Score all eight criteria, write author feedback, and choose a recommendation before submitting.
              </p>
              <button
                type="submit"
                disabled={!scoringComplete || !commentsToAuthor.trim() || !recommendation}
                className="px-6 py-3 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer flex items-center gap-2 disabled:bg-slate-300 disabled:text-slate-600 disabled:cursor-not-allowed"
              >`,
'submit completeness UX'
);

fs.writeFileSync(path, text);
console.log('Phase 19 reviewer scoring patch applied');
