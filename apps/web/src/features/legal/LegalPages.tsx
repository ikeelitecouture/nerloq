import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ArrowRight,
  Compass,
  HeartHandshake,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

type Section = {
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

type LegalPage = {
  eyebrow: string;
  title: string;
  lead: string;
  updated: string;
  icon: React.ReactNode;
  sections: Section[];
};

const SUPPORT_EMAIL = "danieladepoju446@gmail.com";
const LAST_UPDATED = "11 October 2026";

const pages: Record<string, LegalPage> = {
  "/about": {
    eyebrow: "OUR STORY",
    title: "A space for every point of view.",
    lead:
      "NERLOQ is a social platform built around creativity, discovery and meaningful connections. It gives people a place to share their perspectives, discover new creators and bring their ideas to a wider community.",
    updated: LAST_UPDATED,
    icon: <Sparkles size={22} />,
    sections: [
      {
        title: "Why NERLOQ exists",
        paragraphs: [
          "The internet gives everyone a voice, but finding the right people, discovering fresh ideas and sharing original work should feel more intentional. NERLOQ is being built to make those experiences feel connected.",
          "Our goal is to create a welcoming digital space where people can express themselves, explore different perspectives and build relationships through the content they care about.",
        ],
      },
      {
        title: "What you can do here",
        paragraphs: [
          "NERLOQ brings social discovery and creator experiences together in one place. Available features may evolve as the platform develops.",
        ],
        bullets: [
          "Create a profile and introduce yourself to the community.",
          "Publish videos and share the stories behind your ideas.",
          "Discover creators, topics and videos that interest you.",
          "Follow creators and engage through supported interactions.",
          "Connect with other members through direct messaging and notifications.",
          "Manage your publishing preferences and account settings.",
        ],
      },
      {
        title: "Our vision",
        paragraphs: [
          "We want NERLOQ to grow into a thoughtful, creative and accessible community where originality is valued, people can discover one another and creators have room to develop their voice.",
          "We believe a good social platform should make room for expression while taking personal privacy, community safety and responsible participation seriously.",
        ],
      },
      {
        title: "Building with the community",
        paragraphs: [
          "NERLOQ is an evolving product. Features, interfaces and policies may change as we learn, improve reliability and respond to community needs. We aim to communicate important changes clearly.",
          "Every member helps shape the environment by sharing responsibly, respecting other people and using the available reporting and blocking tools when necessary.",
        ],
      },
    ],
  },

  "/privacy": {
    eyebrow: "YOUR INFORMATION",
    title: "Privacy deserves clarity.",
    lead:
      "This Privacy Policy explains the categories of information NERLOQ may process when you use the platform, why that information is needed and the choices available to you.",
    updated: LAST_UPDATED,
    icon: <ShieldCheck size={22} />,
    sections: [
      {
        title: "1. Information you provide",
        paragraphs: [
          "Depending on the features you use, information you provide may include your account details, username, display name, profile information, messages, captions, uploaded videos, comments, reports and other material you choose to submit.",
          "Please avoid placing passwords, financial account details or other highly sensitive information in public profile fields, captions or messages unless a feature explicitly requires it and provides appropriate safeguards.",
        ],
      },
      {
        title: "2. Information generated through use",
        paragraphs: [
          "NERLOQ may process information needed to operate your session and provide requested features. This can include account identifiers, relationships such as follows, content interactions, notification state, timestamps, technical logs and basic device or connection information where available.",
          "The precise information processed depends on the feature, your settings and how you access the service.",
        ],
      },
      {
        title: "3. How information is used",
        paragraphs: [
          "Information may be used to:",
        ],
        bullets: [
          "Create and maintain accounts and authenticate users.",
          "Display profiles, videos and other content according to available visibility controls.",
          "Provide messaging, discovery, notifications and social interactions.",
          "Protect the platform, investigate abuse, enforce our rules and troubleshoot errors.",
          "Respond to support requests, account recovery requests and reports.",
          "Maintain service reliability and meet applicable legal obligations.",
        ],
      },
      {
        title: "4. Content and visibility",
        paragraphs: [
          "Information you publish publicly may be visible to other people and may be copied, recorded or shared by viewers. Do not assume that publicly available content will remain private.",
          "Where NERLOQ provides public, follower-only or private content settings, those controls are intended to govern access through the platform. They cannot guarantee that someone who is authorised to view content will not capture or redistribute it.",
          "Messages and private content should not be treated as an absolute guarantee of confidentiality. Access may be necessary to address security incidents, abuse reports or valid legal requirements, subject to applicable law and operational safeguards.",
        ],
      },
      {
        title: "5. Cookies and local storage",
        paragraphs: [
          "NERLOQ may use browser storage, cookies or similar technologies where needed for session management, authentication, preferences, security and core functionality. Your browser may provide controls for managing or clearing stored data.",
          "Clearing local storage or cookies may sign you out or reset some preferences. It does not necessarily delete information already stored on NERLOQ's servers.",
        ],
      },
      {
        title: "6. Service providers and sharing",
        paragraphs: [
          "Operating a social platform can require trusted infrastructure and service providers for hosting, database operations, media storage, email delivery, security and related technical functions. Information may be processed by such providers when necessary to deliver the service.",
          "NERLOQ does not promise that information is never shared. Information may also be disclosed when required by applicable law or when reasonably necessary to protect users, investigate abuse or safeguard the service.",
          "We do not describe third-party processing as anonymous or limited to a particular country unless that has been verified for the relevant service.",
        ],
      },
      {
        title: "7. Retention and account requests",
        paragraphs: [
          "Information may be retained for as long as needed to operate the service, maintain account and security records, resolve disputes or meet legal obligations. Retention periods can differ by information type and purpose.",
          "If you want to ask about your personal information, request a correction or inquire about account deletion, contact our support address. We will explain the options available for your account. A request may require identity verification, and some information may need to be retained where the law permits or requires it.",
        ],
      },
      {
        title: "8. Security",
        paragraphs: [
          "We use technical and organisational measures intended to protect information. No online service, transmission method or storage system can be guaranteed completely secure.",
          "Choose a strong, unique password, protect your sign-in credentials and contact us if you suspect unauthorised access to your account.",
        ],
      },
      {
        title: "9. Children and eligibility",
        paragraphs: [
          "NERLOQ is not intended for children who are below the minimum age permitted by applicable law or the platform's published eligibility requirements. Do not create an account if you are not eligible to use the service.",
          "If you believe a child has provided personal information inappropriately, contact us so the concern can be reviewed.",
        ],
      },
      {
        title: "10. Changes and contact",
        paragraphs: [
          "We may update this policy as the platform and its practices change. The revised version will be published on this page with an updated date. Material changes should be reviewed before you continue using the service.",
          `For privacy questions or requests, email ${SUPPORT_EMAIL}. Please do not send your password or authentication codes.`,
        ],
      },
    ],
  },

  "/terms": {
    eyebrow: "SERVICE AGREEMENT",
    title: "A clear foundation for connection.",
    lead:
      "These Terms of Service govern your access to and use of NERLOQ. By using the platform, you agree to follow these terms and the Community Guidelines.",
    updated: LAST_UPDATED,
    icon: <HeartHandshake size={22} />,
    sections: [
      {
        title: "1. Using NERLOQ",
        paragraphs: [
          "NERLOQ provides social, content discovery and creator features. Features may change, be limited or become unavailable as the service develops.",
          "You must meet the minimum age and other eligibility requirements that apply to your use of the platform. You must also comply with applicable laws.",
        ],
      },
      {
        title: "2. Your account",
        paragraphs: [
          "Provide information that is accurate to the best of your knowledge, keep your account credentials confidential and take reasonable steps to prevent unauthorised use.",
          "You are responsible for activity carried out through your account to the extent permitted by law. Notify us if you believe your account has been compromised.",
          "Do not impersonate another person, create accounts for deceptive purposes or attempt to bypass account restrictions.",
        ],
      },
      {
        title: "3. Content you share",
        paragraphs: [
          "You retain ownership of content you create, subject to the rights of other people and any applicable third-party rights.",
          "By submitting or publishing content, you grant NERLOQ permission to host, store, process, reproduce and display that content as reasonably necessary to operate the features you use, make the content available to your selected audience, provide requested interactions and maintain the service. This permission is limited to those service-related purposes and lasts as needed for them, subject to applicable retention requirements.",
          "You are responsible for ensuring that you have the rights and permissions needed to upload videos, images, sounds, text and other material. Do not upload material that unlawfully infringes another person's rights.",
        ],
      },
      {
        title: "4. Acceptable use",
        paragraphs: [
          "You may not use NERLOQ to harm other people, disrupt the platform or engage in unlawful activity.",
        ],
        bullets: [
          "Do not harass, threaten, stalk or target people with abusive conduct.",
          "Do not distribute unlawful, exploitative or non-consensual content.",
          "Do not post spam, deceptive promotions, scams or malicious links.",
          "Do not attempt unauthorised access to accounts, systems or private data.",
          "Do not interfere with platform security, availability or normal operation.",
          "Do not manipulate engagement or use automation in ways that abuse the service.",
          "Do not evade moderation decisions or account restrictions.",
        ],
      },
      {
        title: "5. Community safety and moderation",
        paragraphs: [
          "We may review reports, investigate suspected violations and take proportionate action when necessary to protect users or the service. Depending on the circumstances, action may include removing content, limiting features, restricting visibility or suspending or terminating an account.",
          "You can use available reporting and blocking features to raise concerns. We cannot guarantee that every report will result in removal or that every harmful interaction will be detected.",
        ],
      },
      {
        title: "6. Third-party services",
        paragraphs: [
          "NERLOQ may rely on external infrastructure and may contain links or content involving third parties. Their services and privacy practices may be governed by their own terms. We are not responsible for third-party services to the extent permitted by applicable law.",
        ],
      },
      {
        title: "7. Availability and changes",
        paragraphs: [
          "We aim to improve NERLOQ but do not guarantee uninterrupted access, error-free operation or permanent availability of every feature or item of content.",
          "We may update the platform or these terms. Where required by law, we will provide notice or obtain consent for material changes. The latest version will be published on this page.",
        ],
      },
      {
        title: "8. Suspension and termination",
        paragraphs: [
          "You may stop using NERLOQ at any time. We may restrict or terminate access where there is a serious or repeated breach of these terms, a safety concern, a legal requirement or another legitimate operational reason, subject to applicable law.",
          "If you need assistance with your account or want to inquire about deletion, contact support. Ending access does not automatically mean every record is immediately erased.",
        ],
      },
      {
        title: "9. Disclaimers and liability",
        paragraphs: [
          "To the extent permitted by law, NERLOQ is provided on an as-available basis, without guarantees that the service will always be uninterrupted or suitable for every purpose.",
          "Nothing in these terms excludes or limits a right, remedy or liability that cannot lawfully be excluded or limited. Any applicable limitations are subject to mandatory consumer-protection and other legal requirements.",
        ],
      },
      {
        title: "10. Contact",
        paragraphs: [
          `Questions about these terms can be sent to ${SUPPORT_EMAIL}. These terms must be interpreted subject to applicable law and any mandatory rights available to you.`,
        ],
      },
    ],
  },

  "/guidelines": {
    eyebrow: "COMMUNITY STANDARDS",
    title: "Make room for better conversations.",
    lead:
      "NERLOQ is intended to help people express themselves, discover ideas and connect. These guidelines set expectations for participation and help explain the behaviour that may lead to moderation.",
    updated: LAST_UPDATED,
    icon: <Compass size={22} />,
    sections: [
      {
        title: "Treat people with respect",
        paragraphs: [
          "Disagreement and criticism are part of an open community. Targeted abuse, threats, repeated unwanted contact and attempts to intimidate people are not.",
        ],
      },
      {
        title: "Protect personal boundaries",
        paragraphs: [
          "Do not publish another person's private contact details, sensitive personal information, intimate material or private conversations without an appropriate legal basis and permission where required.",
          "Do not impersonate someone, misrepresent your identity to deceive people or use another person's account without authorisation.",
        ],
      },
      {
        title: "Publish responsibly",
        paragraphs: [
          "Only upload content you have the right to share. Respect copyright, privacy, consent and the rights of people who appear in your videos or images.",
          "Content involving exploitation, non-consensual intimate imagery, credible threats, or other unlawful and seriously harmful conduct is not acceptable.",
        ],
      },
      {
        title: "No scams or abusive spam",
        paragraphs: [
          "Do not use the platform to defraud people, distribute malicious links, run deceptive schemes, artificially manipulate engagement or repeatedly send unwanted promotional messages.",
          "Authentic participation matters. Avoid misleading people about who you are, what you offer or why you are contacting them.",
        ],
      },
      {
        title: "Help keep the community safe",
        paragraphs: [
          "Use available reporting tools when you encounter content or behaviour that may violate these guidelines. Provide clear, relevant information and do not use reports to target people simply because you disagree with them.",
          "Blocking and other available controls can help you limit unwanted interactions. If a situation involves an immediate threat to someone's safety, contact the appropriate local emergency or law-enforcement service.",
        ],
      },
      {
        title: "How moderation works",
        paragraphs: [
          "Reported content or accounts may be reviewed in context. Depending on severity, history and applicable requirements, responses may include a warning, content removal, restrictions or account suspension.",
          "Not every report will lead to the same outcome. We aim to consider the circumstances and the safety of the people affected. Features and review processes may evolve as NERLOQ develops.",
        ],
      },
      {
        title: "Appeals and questions",
        paragraphs: [
          `If you believe an enforcement action was made in error, or you need to report a safety concern, contact ${SUPPORT_EMAIL} and explain the situation. Never include your password or sign-in verification codes.`,
        ],
      },
    ],
  },

  "/contact": {
    eyebrow: "WE'RE LISTENING",
    title: "Let's get you the right help.",
    lead:
      "Have a question, found a problem or want to raise a concern about content or your account? Contact the NERLOQ team using the support details below.",
    updated: LAST_UPDATED,
    icon: <Mail size={22} />,
    sections: [
      {
        title: "General support",
        paragraphs: [
          "For help using NERLOQ, questions about features, technical problems or account access, send us an email with a clear description of the issue.",
          `Support email: ${SUPPORT_EMAIL}`,
        ],
      },
      {
        title: "Privacy and personal information",
        paragraphs: [
          "You can contact the same address to ask about your personal information, request a correction or inquire about available account-deletion options. We may need to verify that you control the account before discussing account-specific details.",
        ],
      },
      {
        title: "Report abuse or a safety concern",
        paragraphs: [
          "If you encounter harassment, impersonation, spam or potentially harmful content, use the reporting and blocking controls available in NERLOQ where possible. You may also email support with relevant details, such as the username, content link and a description of the concern.",
          "Please share only the information needed to investigate the issue. Do not email passwords, verification codes or unnecessary sensitive personal information.",
        ],
      },
      {
        title: "Help us investigate",
        paragraphs: [
          "When reporting a technical issue, include what you were trying to do, what happened instead, the approximate time and the type of device or browser you were using. Remove passwords, tokens and other secrets from screenshots or diagnostic information.",
          "We will review your request and respond when possible. Response times may vary depending on the nature and volume of requests.",
        ],
      },
      {
        title: "Official contact details",
        paragraphs: [
          "The email address shown on this page is the current contact address for NERLOQ support. We do not claim to operate a custom-domain support mailbox unless one has been configured and verified.",
        ],
      },
    ],
  },
};

const navigation = [
  { to: "/about", label: "About" },
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/guidelines", label: "Community guidelines" },
  { to: "/contact", label: "Contact" },
];

export function LegalPages(): React.JSX.Element {
  const location = useLocation();
  const page = pages[location.pathname];

  if (!page) {
    return (
      <main className="legal-page" id="main-content" tabIndex={-1}>
        <p>Information page not found.</p>
        <Link to="/about">Explore NERLOQ</Link>
      </main>
    );
  }

  return (
    <main className="legal-page" id="main-content" tabIndex={-1}>
      <header className="legal-header">
        <Link to="/" className="legal-brand" aria-label="NERLOQ home">
          <span className="legal-brand-mark">
            <img src="/nerloq.png" alt="" />
          </span>
          <span>NERLOQ</span>
        </Link>
        <nav className="legal-header-actions" aria-label="Account navigation">
          <Link to="/login" className="quiet-action">Sign in</Link>
          <Link to="/join" className="primary-action">Join NERLOQ <ArrowRight size={15} /></Link>
        </nav>
      </header>

      <div className="legal-wrap">
        <div className="legal-breadcrumb">
          <Link to="/">NERLOQ</Link><span>/</span><span>{page.eyebrow}</span>
        </div>

        <section className="legal-hero">
          <div className="legal-hero-icon">{page.icon}</div>
          <span className="eyebrow">{page.eyebrow}</span>
          <h1>{page.title}</h1>
          <p className="legal-lead">{page.lead}</p>
          <div className="legal-meta">
            <span>NERLOQ · OFFICIAL INFORMATION</span>
            <span>Updated {page.updated}</span>
          </div>
        </section>

        {location.pathname === "/about" && (
          <section className="legal-values" aria-label="Our principles">
            <article><Sparkles size={18}/><strong>Creativity</strong><span>Make something worth sharing.</span></article>
            <article><Compass size={18}/><strong>Discovery</strong><span>Find ideas and perspectives.</span></article>
            <article><HeartHandshake size={18}/><strong>Connection</strong><span>Build a more thoughtful community.</span></article>
          </section>
        )}

        {location.pathname === "/contact" && (
          <section className="legal-contact-card">
            <div className="legal-contact-icon"><Mail size={22}/></div>
            <div><span className="eyebrow">NERLOQ SUPPORT</span><h2>Tell us how we can help.</h2><p>Send your question or concern to our current support address.</p><a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL} <ArrowRight size={15}/></a></div>
          </section>
        )}

        <div className="legal-body">
          <aside className="legal-toc">
            <span className="eyebrow">ON THIS PAGE</span>
            {page.sections.map((section, index) => (
              <a key={section.title} href={`#legal-section-${index + 1}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>{section.title}
              </a>
            ))}
          </aside>
          <div className="legal-sections">
            {page.sections.map((section, index) => (
              <section className="legal-section" id={`legal-section-${index + 1}`} key={section.title}>
                <span className="legal-section-number">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h2>{section.title}</h2>
                  {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  {section.bullets && (
                    <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>
                  )}
                </div>
              </section>
            ))}
            <div className="legal-note">
              <ShieldCheck size={17}/>
              <p>
                These pages describe NERLOQ's intended policies and current understanding of its service.
                They should be reviewed for legal compliance and updated as the product, data practices and
                applicable requirements evolve.
              </p>
            </div>
          </div>
        </div>
      </div>

      <footer className="legal-footer">
        <div className="legal-footer-top">
          <Link to="/" className="legal-brand">
            <span className="legal-brand-mark"><img src="/nerloq.png" alt="" /></span>
            <span>NERLOQ</span>
          </Link>
          <p>CREATE. CONNECT. DISCOVER.</p>
        </div>
        <nav className="legal-footer-links" aria-label="Information and policies">
          {navigation.map((item) => <Link key={item.to} to={item.to}>{item.label}</Link>)}
        </nav>
        <div className="legal-footer-bottom">
          <span>© {new Date().getFullYear()} NERLOQ</span>
          <span>Built for creativity, discovery and connection.</span>
        </div>
      </footer>
    </main>
  );
}
