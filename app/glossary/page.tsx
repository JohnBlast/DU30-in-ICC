"use client";

/**
 * Glossary of ICC legal and Latin terms.
 * Links from answers point here. Users can also browse.
 * Styled with Primer design system.
 */

import Link from "next/link";
import { Button } from "@primer/react";
import { ArrowLeftIcon } from "@primer/octicons-react";

const TERMS: Array<{ slug: string; term: string; definition: string }> = [
  {
    slug: "confirmation-of-charges",
    term: "Confirmation of charges",
    definition:
      "A pre-trial hearing where the ICC decides whether there is sufficient evidence to proceed to trial. If confirmed, the case goes to trial.",
  },
  {
    slug: "in-absentia",
    term: "In absentia",
    definition:
      "Latin for 'in absence.' A hearing or trial can proceed without the accused being physically present, under certain ICC rules.",
  },
  {
    slug: "proprio-motu",
    term: "Proprio motu",
    definition:
      "Latin for 'on its own motion.' The ICC Prosecutor can initiate an investigation without a State referral or Security Council request.",
  },
  {
    slug: "crimes-against-humanity",
    term: "Crimes against humanity",
    definition:
      "Serious crimes (murder, extermination, torture, etc.) committed as part of a widespread or systematic attack on a civilian population.",
  },
  {
    slug: "pre-trial-chamber",
    term: "Pre-trial chamber",
    definition:
      "An ICC chamber that handles the early phases of a case, including arrest warrants, confirmation of charges, and preliminary decisions.",
  },
  {
    slug: "document-containing-the-charges",
    term: "Document Containing the Charges (DCC)",
    definition:
      "The formal document in which the Prosecutor sets out the charges and supporting evidence. Presented before the confirmation hearing.",
  },
  {
    slug: "office-of-the-prosecutor",
    term: "Office of the Prosecutor (OTP)",
    definition:
      "The independent organ of the ICC responsible for conducting investigations and prosecutions.",
  },
  {
    slug: "rome-statute",
    term: "Rome Statute",
    definition:
      "The treaty that established the International Criminal Court. It defines the crimes within ICC jurisdiction and court procedures.",
  },
  {
    slug: "elements-of-crimes",
    term: "Elements of Crimes",
    definition:
      "A document that elaborates on the Rome Statute, defining the specific elements that must be proven for each crime.",
  },
  {
    slug: "rules-of-procedure-and-evidence",
    term: "Rules of Procedure and Evidence",
    definition: "ICC rules governing how proceedings are conducted and what evidence is admissible.",
  },
  {
    slug: "icc",
    term: "ICC",
    definition:
      "International Criminal Court — a permanent court that prosecutes genocide, crimes against humanity, war crimes, and the crime of aggression.",
  },
];

export default function GlossaryPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
              aria-label="Back to chat"
            >
              <ArrowLeftIcon size={20} />
            </Link>
            <Link
              href="/"
              className="hidden py-2 text-lg font-bold text-gray-900 hover:underline sm:block sm:text-xl"
            >
              The Docket
            </Link>
          </div>
          <form action="/api/auth/logout" method="POST" className="shrink-0">
            <Button variant="default" type="submit" size="small" className="min-h-[44px] px-4">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-bold text-gray-900">Glossary</h1>
        <p className="mt-2 text-sm text-gray-600">
          ICC legal and Latin terms. Ask &quot;What does [term] mean?&quot; in the chat for
          definitions from ICC documents.
        </p>

        <dl className="mt-8 space-y-6">
          {TERMS.map((t) => (
            <div key={t.slug} id={t.slug} className="scroll-mt-20">
              <dt className="text-lg font-semibold text-gray-900">{t.term}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-gray-700">{t.definition}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
