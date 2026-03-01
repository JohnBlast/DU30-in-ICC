/**
 * ICC document URLs for RAG ingestion (PRD §15.1).
 * RAG 1 = Legal framework; RAG 2 = Case documents.
 */

export type DocumentType = "case_record" | "press_release" | "legal_text" | "case_info_sheet";

export interface IccUrlConfig {
  url: string;
  title: string;
  ragIndex: 1 | 2;
  documentType: DocumentType;
  /** Discovery job: extract links from this page instead of ingesting its content directly */
  isDiscoveryPage?: boolean;
  /** If true, scrape full page (not onlyMainContent) to capture FAQs, Q&A sections, sidebars */
  fullPage?: boolean;
}

export const ICC_URLS: IccUrlConfig[] = [
  // RAG 1 — Legal framework
  {
    url: "https://www.icc-cpi.int/publications/core-legal-texts",
    title: "Core Legal Texts hub",
    ragIndex: 1,
    documentType: "legal_text",
  },
  {
    url: "https://www.icc-cpi.int/sites/default/files/2024-05/Rome-Statute-eng.pdf",
    title: "Rome Statute",
    ragIndex: 1,
    documentType: "legal_text",
  },
  {
    url: "https://www.icc-cpi.int/sites/default/files/Publications/Rules-of-Procedure-and-Evidence.pdf",
    title: "Rules of Procedure and Evidence",
    ragIndex: 1,
    documentType: "legal_text",
  },
  {
    url: "https://www.icc-cpi.int/sites/default/files/Publications/Elements-of-Crimes.pdf",
    title: "Elements of Crimes",
    ragIndex: 1,
    documentType: "legal_text",
  },
  {
    url: "https://www.icc-cpi.int/about/how-the-court-works",
    title: "How the Court Works",
    ragIndex: 1,
    documentType: "legal_text",
  },
  {
    url: "https://www.icc-cpi.int/resource-library",
    title: "Resource Library",
    ragIndex: 1,
    documentType: "legal_text",
  },
  // RAG 2 — Case documents
  {
    url: "https://www.icc-cpi.int/philippines/duterte",
    title: "Main Duterte case page",
    ragIndex: 2,
    documentType: "case_info_sheet",
    fullPage: true, // Capture FAQs, Q&A, judges, measures for attendance
  },
  {
    url: "https://www.icc-cpi.int/philippines",
    title: "Philippines situation page",
    ragIndex: 2,
    documentType: "case_info_sheet",
  },
  {
    url: "https://www.icc-cpi.int/case-records?f%5B0%5D=cr_case_code%3A1527",
    title: "Case records — filtered filings",
    ragIndex: 2,
    documentType: "case_record",
    isDiscoveryPage: true,
  },
  {
    url: "https://www.icc-cpi.int/sites/default/files/2026-02/DuterteEng.pdf",
    title: "Case Information Sheet (Feb 2026)",
    ragIndex: 2,
    documentType: "case_info_sheet",
  },
  {
    url: "https://www.icc-cpi.int/sites/default/files/2025-07/Duterte%20Case%20Key%20Messages.pdf",
    title: "Key Messages document",
    ragIndex: 2,
    documentType: "press_release",
  },
  {
    url: "https://www.icc-cpi.int/sites/default/files/CourtRecords/0902ebd180c9bfd4.pdf",
    title: "Document Containing the Charges (Sep 2025)",
    ragIndex: 2,
    documentType: "case_record",
  },
  {
    url: "https://www.icc-cpi.int/victims/duterte-case",
    title: "Victims page",
    ragIndex: 2,
    documentType: "case_info_sheet",
    fullPage: true, // Q&A on confirmation hearing, judges, measures
  },
];

/** URLs for direct ingestion (excludes discovery page). */
export const ICC_INGESTION_URLS = ICC_URLS.filter((u) => !u.isDiscoveryPage);

/** Case records discovery URL (Job 2). */
export const CASE_RECORDS_DISCOVERY_URL =
  ICC_URLS.find((u) => u.isDiscoveryPage)?.url ??
  "https://www.icc-cpi.int/case-records?f%5B0%5D=cr_case_code%3A1527";
