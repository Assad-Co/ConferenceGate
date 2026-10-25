import React, { useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, Mail, MessageCircleQuestion, ShieldCheck, FileText } from 'lucide-react';

type SupportPage = 'faq' | 'contact' | 'privacy' | 'terms';

interface SupportCenterProps {
  page: SupportPage;
  accountEmail?: string;
  onBack: () => void;
}

const FAQS = [
  ['What is ConferenceGate?', 'ConferenceGate helps professionals discover conferences, manage participation, build verified professional records, and connect with organizers and sponsors.'],
  ['How do I find a conference?', 'Open Discover Conferences and search by conference name, acronym, discipline, city, country, organizer, or topic. ConferenceGate also surfaces external worldwide conference results when available.'],
  ['How do I submit and track an abstract?', 'Open a conference, choose Submit Abstract, complete the submission form, and track the status from Abstracts. Organizer decisions and review activity appear in your account notifications.'],
  ['How does the LinkedIn professional-profile import work?', 'In Edit Profile, add your LinkedIn profile URL and choose Import professional profile. ConferenceGate imports available public professional information such as experience, education, publications, patents, and certifications. Existing profile fields are not silently overwritten.'],
  ['How do organizers publish a conference?', 'Organizer accounts can create a conference, add event details, CFP information, deadlines, speakers, committees, and sponsorship information, then publish it so it can appear in ConferenceGate discovery.'],
  ['How are conference records verified?', 'ConferenceGate uses source-labeled evidence and official conference sources where available. External results should always be reviewed against the linked official source before making travel, payment, or submission decisions.'],
  ['How do notifications and messages work?', 'Notifications open the related ConferenceGate activity when possible. Messaging supports professional, organizer, and sponsor communication within the platform.'],
  ['Can I correct inaccurate conference information?', 'Yes. Use Ask Us and include the conference name, official source URL, and the information that needs correction.'],
  ['Is ConferenceGate free?', 'Professional access currently includes core discovery and professional-profile features. Organizer and sponsor commercial plans may be introduced or changed separately.'],
  ['How do I get help with my account?', 'Open Ask Us from the footer and contact ConferenceGate support. Do not send passwords, recovery codes, or other sensitive credentials.'],
];

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 sm:p-7">{children}</div>
);

export const SupportCenter: React.FC<SupportCenterProps> = ({ page, accountEmail = '', onBack }) => {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(accountEmail);
  const [topic, setTopic] = useState('General question');
  const [message, setMessage] = useState('');

  const title = useMemo(() => ({
    faq: 'Frequently Asked Questions',
    contact: 'Ask Us',
    privacy: 'Privacy Policy',
    terms: 'Terms of Use',
  }[page]), [page]);

  const sendEmail = (event: React.FormEvent) => {
    event.preventDefault();
    const subject = `[ConferenceGate Support] ${topic}`;
    const body = [
      `Name: ${name || 'Not provided'}`,
      `Email: ${email || 'Not provided'}`,
      `Topic: ${topic}`,
      '',
      message,
    ].join('\n');
    window.location.href = `mailto:support@conferencegate.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <section className="max-w-4xl mx-auto py-4 sm:py-8">
      <button onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900 mb-5 cursor-pointer">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="mb-7">
        <div className="flex items-center gap-3 mb-2">
          {page === 'faq' && <MessageCircleQuestion className="w-7 h-7 text-blue-700" />}
          {page === 'contact' && <Mail className="w-7 h-7 text-blue-700" />}
          {page === 'privacy' && <ShieldCheck className="w-7 h-7 text-blue-700" />}
          {page === 'terms' && <FileText className="w-7 h-7 text-blue-700" />}
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-950">{title}</h1>
        </div>
        <p className="text-sm text-slate-500">ConferenceGate support and platform information.</p>
      </div>

      {page === 'faq' && (
        <div className="space-y-3">
          {FAQS.map(([question, answer], index) => (
            <div key={question} className="border border-slate-200 rounded-xl bg-white overflow-hidden">
              <button
                onClick={() => setOpenFaq(openFaq === index ? null : index)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left cursor-pointer"
              >
                <span className="font-bold text-sm text-slate-900">{question}</span>
                <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${openFaq === index ? 'rotate-180' : ''}`} />
              </button>
              {openFaq === index && <p className="px-5 pb-5 text-sm leading-6 text-slate-600">{answer}</p>}
            </div>
          ))}
        </div>
      )}

      {page === 'contact' && (
        <Card>
          <div className="mb-5">
            <h2 className="text-lg font-extrabold text-slate-900">How can we help?</h2>
            <p className="text-sm text-slate-500 mt-1">Complete the form and your email application will open with the message addressed to support@conferencegate.com.</p>
          </div>
          <form onSubmit={sendEmail} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div><label className="block text-xs font-bold text-slate-600 mb-1.5">Name</label><input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm" /></div>
              <div><label className="block text-xs font-bold text-slate-600 mb-1.5">Email</label><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm" /></div>
            </div>
            <div><label className="block text-xs font-bold text-slate-600 mb-1.5">Topic</label><select value={topic} onChange={(e) => setTopic(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm bg-white"><option>General question</option><option>Account & login</option><option>Conference information correction</option><option>Abstracts & reviewing</option><option>Organizer support</option><option>Sponsor support</option><option>Technical issue</option><option>Privacy request</option></select></div>
            <div><label className="block text-xs font-bold text-slate-600 mb-1.5">Message</label><textarea required rows={6} value={message} onChange={(e) => setMessage(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm resize-y" placeholder="Tell us what you need help with..." /></div>
            <button type="submit" className="inline-flex items-center gap-2 rounded-full bg-blue-900 hover:bg-blue-950 text-white font-bold text-sm px-6 py-2.5 cursor-pointer"><Mail className="w-4 h-4" /> Email Support</button>
            <p className="text-[11px] text-slate-400">For your security, never include passwords, recovery codes, payment-card details, or private authentication credentials.</p>
          </form>
        </Card>
      )}

      {page === 'privacy' && (
        <Card><div className="space-y-5 text-sm leading-6 text-slate-600">
          <p><strong className="text-slate-900">Data controller.</strong> ConferenceGate OÜ, registered address: Sepapaja tn 6, 15551 Tallinn, Harju Maakond, Estonia, operates the ConferenceGate platform. Privacy requests may be submitted using the Ask Us feature. Please do not include passwords or sensitive credentials.</p>
          <p><strong className="text-slate-900">Privacy at ConferenceGate.</strong> ConferenceGate uses account and profile information to provide conference discovery, participation, messaging, professional-profile, organizer, and sponsor features.</p>
          <p><strong className="text-slate-900">Information you provide.</strong> This may include your name, email, role, organization, professional profile details, conference activity, messages, submissions, reviews, and information you choose to import or publish.</p>
          <p><strong className="text-slate-900">Public professional information.</strong> When you request a professional-profile import, ConferenceGate may process publicly available professional information and source-labeled evidence to enrich your profile.</p>
          <p><strong className="text-slate-900">Purposes and lawful bases.</strong> Account and platform information is processed to provide requested services, administer accounts, maintain security, and meet applicable legal obligations. Other processing, including optional analytics or marketing, must have an appropriate legal basis and, where required, consent.</p>
          <p><strong className="text-slate-900">Your rights.</strong> Subject to applicable law, you may request access, correction, deletion, restriction, portability, or object to certain processing, and withdraw consent where processing relies on it. You may also lodge a complaint with a competent data protection authority.</p>
          <p><strong className="text-slate-900">Service providers and international transfers.</strong> Hosting, authentication, communications, analytics, and payment providers may process information to support the platform. Any international transfer must use a valid legal transfer mechanism where required.</p>
          <p><strong className="text-slate-900">Retention.</strong> Information is retained only as long as needed for its stated purposes, contractual commitments, legitimate operational needs, and applicable legal requirements. Specific retention periods should be documented before launch.</p>
          <p><strong className="text-slate-900">Security.</strong> ConferenceGate uses authentication and access controls designed to keep private workspaces and account activity separated. Users should protect their own credentials and report suspected unauthorized access promptly.</p>
          <p><strong className="text-slate-900">Contact.</strong> Privacy questions or requests can be submitted through Ask Us.</p>
          <p className="text-xs text-slate-400">Launch version · Last updated October 2026. This page should be reviewed by qualified legal counsel before material commercial expansion.</p>
        </div></Card>
      )}

      {page === 'terms' && (
        <Card><div className="space-y-5 text-sm leading-6 text-slate-600">
          <p><strong className="text-slate-900">Platform operator.</strong> ConferenceGate is operated by ConferenceGate OÜ, registered address: Sepapaja tn 6, 15551 Tallinn, Harju Maakond, Estonia.</p>
          <p><strong className="text-slate-900">Using ConferenceGate.</strong> Users must provide lawful information, respect other members, and use ConferenceGate only for legitimate conference, professional, organizer, and sponsor activity.</p>
          <p><strong className="text-slate-900">Conference information.</strong> ConferenceGate may aggregate information from official and public sources. Dates, fees, deadlines, speakers, venues, and other details can change. Users should confirm important decisions with the linked official conference source.</p>
          <p><strong className="text-slate-900">User content.</strong> You remain responsible for abstracts, profile information, messages, reviews, conference listings, sponsorship content, and other material you submit.</p>
          <p><strong className="text-slate-900">Accounts and access.</strong> Do not share credentials or attempt to access another user's private workspace or data. ConferenceGate may restrict accounts used for abuse, fraud, impersonation, or unauthorized access.</p>
          <p><strong className="text-slate-900">Organizer and sponsor responsibilities.</strong> Organizers and sponsors must ensure their published claims, event details, intellectual property, and offers are accurate and lawful. ConferenceGate does not independently guarantee every third-party conference listing.</p>
          <p><strong className="text-slate-900">Changes and disputes.</strong> Material changes to these terms should be communicated appropriately. Applicable consumer rights and mandatory legal protections remain unaffected; dispute and governing-law details require review before commercial launch.</p>
          <p><strong className="text-slate-900">Commercial features.</strong> Paid organizer, sponsor, and transaction features may be governed by additional terms when activated.</p>
          <p className="text-xs text-slate-400">Launch version · Last updated October 2026. This page should be reviewed by qualified legal counsel before material commercial expansion.</p>
        </div></Card>
      )}
    </section>
  );
};

export default SupportCenter;
