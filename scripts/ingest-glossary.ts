#!/usr/bin/env npx tsx
/**
 * Ingest synthetic glossary chunks as embedding anchors (production-hardening Phase 5).
 * Usage: npm run ingest-glossary
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { createHash } from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

const GLOSSARY_DOC_URL = "https://the-docket.internal/glossary";
const GLOSSARY_DOC_TITLE = "The Docket — Domain Glossary (System-Generated)";

const GLOSSARY_ENTRIES: Array<{ term: string; content: string }> = [
  {
    term: "Oplan Tokhang",
    content: `Oplan Tokhang (from "toktok hangyo" — "knock and plead" in Cebuano) is the Philippine National Police (PNP) anti-drug campaign launched in 2016. It involves door-to-door operations where police visit suspected drug users and pushers to urge them to surrender and undergo rehabilitation. The campaign has been referenced in ICC documents in connection with the Philippines situation and charges related to the drug war. Tokhang operations, extrajudicial killings, and alleged state policy are central to the ICC Prosecutor's investigation. Synonyms: Tokhang, Oplan Tokhang, knock and plead.`,
  },
  {
    term: "Davao Death Squad (DDS)",
    content: `The Davao Death Squad (DDS) refers to an alleged extrajudicial killing group operating in Davao City, Philippines. ICC documents link these allegations to Rodrigo Duterte's tenure as mayor of Davao City. The Prosecutor's investigation examines whether Davao Death Squad killings form part of a broader pattern of crimes against humanity. Synonyms: DDS, Davao Death Squad, vigilante killings.`,
  },
  {
    term: "Project Double Barrel",
    content: `Project Double Barrel is the PNP's anti-drug framework with two components: supply reduction (Project Tokhang) and demand reduction. It was launched in 2016 and is referenced in ICC documents concerning the Philippines situation. The framework's implementation and alleged connection to extrajudicial killings are examined in the ICC proceedings. Synonyms: Double Barrel, Project Double Barrel, supply reduction, demand reduction.`,
  },
  {
    term: "EJK / Extrajudicial killings",
    content: `Extrajudicial killings (EJK) are killings carried out outside the judicial process, without legal sanction. EJKs are central to the ICC charges against Duterte regarding the Philippines drug war. The Prosecutor alleges that killings occurred as part of a state policy. Synonyms: EJK, extrajudicial killing, extrajudicial killings, unlawful killing, summary execution.`,
  },
  {
    term: "Nanlaban",
    content: `Nanlaban is a Filipino term meaning "fought back." It is commonly used by Philippine police as justification for lethal force during anti-drug operations, claiming suspects resisted arrest. ICC documents examine whether "nanlaban" claims are used to cover up extrajudicial killings. Synonyms: nanlaban, fought back, resisted arrest.`,
  },
  {
    term: "Salvaging",
    content: `Salvaging is Filipino slang for extrajudicial killing or summary execution. The term is used in ICC context when discussing alleged vigilante or state-linked killings. Synonyms: salvaging, salvage, summary execution, EJK.`,
  },
  {
    term: "DCC (Document Containing the Charges)",
    content: `The Document Containing the Charges (DCC) is an ICC pre-trial document that specifies the charges against the accused. It is submitted by the Prosecutor and reviewed by the Pre-Trial Chamber. In the Philippines situation, the DCC sets out the charges of crimes against humanity. Synonyms: DCC, Document Containing the Charges, charges document.`,
  },
  {
    term: "OPCV",
    content: `OPCV stands for Office of Public Counsel for Victims. It is an ICC organ that provides legal representation and support to victims participating in ICC proceedings. The OPCV assists victims in filing applications, presenting views, and seeking reparations. Synonyms: OPCV, Office of Public Counsel for Victims, victims' counsel.`,
  },
  {
    term: "OTP",
    content: `OTP stands for Office of the Prosecutor. It is the ICC's prosecution arm, responsible for conducting investigations and prosecutions. The OTP initiated the Philippines situation and brought charges. Synonyms: OTP, Office of the Prosecutor, Prosecutor.`,
  },
  {
    term: "Confirmation of Charges",
    content: `Confirmation of Charges is the ICC pre-trial hearing where a judge decides whether there is sufficient evidence for the case to proceed to trial. If confirmed, the case is sent to a Trial Chamber. The Philippines situation has undergone confirmation of charges proceedings. Synonyms: confirmation of charges, confirmation hearing, pre-trial confirmation.`,
  },
  {
    term: "Article 7 Rome Statute",
    content: `Article 7 of the Rome Statute defines crimes against humanity. It lists acts such as murder, imprisonment, torture, persecution, and other inhumane acts when committed as part of a widespread or systematic attack directed against a civilian population. The Philippines charges fall under Article 7. Synonyms: Article 7, crimes against humanity, Rome Statute Article 7.`,
  },
  {
    term: "Article 15 Rome Statute",
    content: `Article 15 of the Rome Statute grants the Prosecutor authority to initiate investigations proprio motu (on his or her own initiative) into crimes within the Court's jurisdiction. The Prosecutor must seek authorization from the Pre-Trial Chamber. Synonyms: Article 15, proprio motu, Prosecutor's own initiative.`,
  },
  {
    term: "Article 18 Rome Statute",
    content: `Article 18 of the Rome Statute governs preliminary rulings on admissibility. It allows states to inform the Court that they are investigating or have investigated the same conduct, and provides for deferral to national proceedings. The Philippines invoked Article 18 in its admissibility challenge. Synonyms: Article 18, admissibility, deferral, preliminary rulings.`,
  },
  {
    term: "Complementarity",
    content: `Complementarity is the principle that the ICC only acts when domestic courts are unwilling or unable to genuinely investigate and prosecute. The ICC is complementary to national jurisdictions. The Philippines admissibility challenge turned on whether its domestic proceedings satisfied complementarity. Synonyms: complementarity, complementary, domestic jurisdiction.`,
  },
  {
    term: "In absentia",
    content: `In absentia means in the absence of the accused. ICC proceedings can continue in absentia in certain circumstances when the accused does not appear. The Philippines situation has involved proceedings without the accused present. Synonyms: in absentia, absent, without the accused.`,
  },
];

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !OPENAI_API_KEY) {
    console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const chunks = GLOSSARY_ENTRIES.map((e) => e.content);
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: chunks,
  });
  const embeddings = res.data
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding);

  const datePublished = new Date().toISOString().slice(0, 10);
  const contentHash = createHash("sha256")
    .update(chunks.join("\n"))
    .digest("hex");

  const { data: existingDoc } = await supabase
    .from("icc_documents")
    .select("document_id")
    .eq("url", GLOSSARY_DOC_URL)
    .single();

  let documentId: string;
  if (existingDoc) {
    documentId = existingDoc.document_id;
    await supabase.from("document_chunks").delete().eq("document_id", documentId);
    await supabase
      .from("icc_documents")
      .update({
        content_hash: contentHash,
        date_published: datePublished,
        last_crawled_at: new Date().toISOString(),
      })
      .eq("document_id", documentId);
  } else {
    const { data: docRow, error: docErr } = await supabase
      .from("icc_documents")
      .insert({
        title: GLOSSARY_DOC_TITLE,
        url: GLOSSARY_DOC_URL,
        document_type: "glossary",
        rag_index: 2,
        content_hash: contentHash,
        date_published: datePublished,
        last_crawled_at: new Date().toISOString(),
      })
      .select("document_id")
      .single();

    if (docErr || !docRow) {
      throw new Error(`Failed to insert glossary document: ${docErr?.message ?? "unknown"}`);
    }
    documentId = docRow.document_id;
  }

  const metadata = {
    document_title: GLOSSARY_DOC_TITLE,
    url: GLOSSARY_DOC_URL,
    date_published: datePublished,
    rag_index: "2",
    document_type: "glossary",
  };

  const rows = chunks.map((content, i) => ({
    document_id: documentId,
    content,
    embedding: embeddings[i],
    chunk_index: i,
    token_count: Math.ceil(content.length / 4),
    metadata,
  }));

  const { error } = await supabase.from("document_chunks").insert(rows);
  if (error) throw new Error(`Failed to insert glossary chunks: ${error.message}`);

  console.log(`[Docket:Ingest-Glossary] Ingested ${chunks.length} glossary chunks`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
