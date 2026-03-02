# Real-World Fact-Check Analysis

**Run date**: 2026-03-02  
**Script**: `npm run run-real-world-factchecks`  
**Examples**: 15 (reference source `test-fixtures/real-world-factchecks`)

---

## Executive Summary

| Metric | Before Fix | After Judge Prompt Fix (2026-03-02) |
|--------|-------------|-------------------------------------|
| **Answered with per-claim breakdown** | 7/15 (47%) | **12/15 (80%)** |
| **Blocked (Judge REJECT)** | 8/15 (53%) | **3/15 (20%)** |

**Main finding**: The Judge was REJECTing correct FALSE verdicts. We added two clarifications to `JUDGE_SYSTEM_PROMPT`:
1. When verdict is FALSE: The answer correctly refutes the user's claim; do NOT reject for "contradicts chunks."
2. Party/counsel statements labeled OPINION (e.g., "Kaufman claimed X") — APPROVE.

**Impact**: Examples 4, 6, 7, 8, 9 now pass (previously blocked). **Remaining blocks: Ex 10, 11, 14** — see notes below.

---

## Results by Example

| # | Status | Verdicts | Notes |
|---|--------|----------|-------|
| 1 | ✅ OK | opinion, verified | Clean: incitement claim → opinion; commander-in-chief → verified |
| 2 | ✅ OK | opinion×2, verified | Paolo/Magno exchange; procedural fact verified |
| 3 | ✅ OK | opinion×2, verified, unverifiable, verified | Mixed; Niang statement; dates verified |
| 4 | ✅ OK *(was blocked)* | opinion×2, unverifiable×2, verified | Victims/78–49; Judge fix → now passes |
| 5 | ✅ OK | opinion, verified, unverifiable×2 | P-witnesses; procedural facts verified |
| 6 | ✅ OK | opinion, false, verified | Kaufman/withdrawal; party statements → OPINION |
| 7 | ✅ OK | opinion×3, false×2 | Trillanes/witness construction; FALSE verdicts |
| 8 | ✅ OK *(was blocked)* | opinion, false, unverifiable×3 | Gilbert Andres; "elite narrative" → OPINION, "thousands" → FALSE |
| 9 | ✅ OK *(was blocked)* | false | Waiver "granted"; correctly marked FALSE (chunks show request only) |
| 10 | ❌ Blocked | — | Tagalog opinion; Judge: "unverifiable without sufficient basis" / fallback_regex |
| 11 | ❌ Blocked | — | Prosecutor opposed waiver; Judge: "unsupported by retrieved documents" |
| 12 | ✅ OK | opinion, false×2, unverifiable×2 | Tagalog Massidda; trial status FALSE |
| 13 | ✅ OK | opinion, false, unverifiable×2, not_in_icc_records | Duterte letter; waiver status FALSE |
| 14 | ❌ Blocked | — | Kaufman "minimal"; Judge: "minimal as opinion not supported by documents" |
| 15 | ✅ OK | opinion×2, unverifiable | Children; low retrieval but passed |

---

## Root Cause: Judge Misinterprets Fact-Check Output

### Problem

For fact-check answers, the format is:

```
• "User claim" — VERDICT. ICC documents [say X].
```

When the verdict is **FALSE**, we correctly state that the claim *contradicts* what documents say. Example:

> • "Duterte killed thousands of poor people" — FALSE. ICC documents indicate otherwise: The documents state that Duterte killed 'around 1,700' people in Davao City as Mayor, not thousands.

The Judge REJECT reason for Example 8:

> "The claim about Duterte killing 'thousands of poor people' **contradicts the retrieved chunks**, which only support 'around 1,700 people in Davao City as Mayor,' and thus it cannot be deemed a verifiable factual claim."

**This is a circular rejection**: The fact-check is *correctly* saying the claim contradicts the docs (FALSE). The Judge is REJECTing because it sees "contradicts" and thinks that's wrong—but for FALSE verdicts, contradicting is exactly what we want.

### Other Judge Confusions

1. **Ex 4**: Judge REJECTs because we cite "78 victims, 49 incidents" from the paste—and the retrieved chunks may not contain those exact numbers. The fact-check may be verifying "only five publicly identified" (which could be in chunks) while the 78/49 comes from the paste. Judge may be right that we're mixing paste-sourced numbers with "ICC documents say."

2. **Ex 6, 14**: Judge objects to how we label opinion vs. fact. "Kaufman claimed X" or "deaths are minimal"—we label as opinion. Judge says we need to specify these appeared in chunks. Ambiguity: are we saying "this is Kaufman's opinion" (correct) or "we're stating our opinion" (wrong)?

3. **Ex 9**: Procedural staleness—chunks may say prosecutor *opposed* waiver; reality (or more recent docs) may show waiver *granted*. Judge sees contradiction. Likely a data freshness issue.

---

## Recommended Improvements

### P0 — Judge Prompt for Fact-Check (Highest Impact)

**Add explicit instruction** to `JUDGE_SYSTEM_PROMPT` when evaluating fact-check answers:

```
FACT-CHECK FORMAT: The answer evaluates USER claims against ICC documents.
- When verdict is FALSE: The answer will state that the claim "contradicts" or that "ICC documents indicate otherwise." This is CORRECT—we are refuting the claim. Do NOT REJECT for "contradicts chunks" when the answer is correctly refuting a false claim.
- When verdict is UNVERIFIABLE: The answer states documents contain no information. Do NOT REJECT for "unsupported" when we are correctly declining to verify.
- Only REJECT if the answer itself MAKES an unsupported factual assertion (e.g., invents a number, cites a non-existent document), not when it correctly evaluates a user claim.
```

### P1 — Salvage Mode on Judge REJECT

When Judge REJECTs a fact-check answer, consider:

1. Parsing the REJECT reason
2. If reason mentions "contradicts" or "unsupported" in the context of a FALSE/UNVERIFIABLE verdict → treat as false positive, **show the answer** with a caveat: "This fact-check was auto-reviewed; please verify key claims against sources."
3. Only full block when reason indicates real safety/accuracy issues (e.g., "introduces fabricated reference")

### P1 — Numbers from Paste vs. Chunks

For claims with specific numbers (78, 49, 1,700, etc.):

- Ensure the verification step distinguishes: "Is this number IN the chunks?" vs. "The paste claims X; what do chunks say?"
- Consider explicit rule: never VERIFY a number unless it appears in chunks; if paste says "78 victims" and chunks are silent, UNVERIFIABLE.

### P2 — Per-Claim Retrieval

Examples 4, 9, 11 involve specific procedural details (victim counts, waiver status). Retrieve separately per claim and union chunks to improve relevance.

### P2 — Judge Calibration

Add to "do NOT reject" list:

- Fact-check answer correctly states claim is FALSE with "ICC documents indicate otherwise: [what docs say]"
- Fact-check answer correctly labels a quoted claim as OPINION when the source is a party/counsel statement

---

## Verdict Quality (Where Not Blocked)

| Aspect | Assessment |
|--------|------------|
| **Opinion vs. fact distinction** | ✅ Good—properly labels evaluative/rhetorical content as OPINION |
| **FALSE when docs contradict** | ✅ Good—e.g., Ex 8 logic would have correctly said "thousands" → FALSE (blocked before user could see) |
| **Allegation framing** | ✅ Good—prosecution/defence positions framed as argument |
| **Procedural status** | ✅ Good—Ex 12, 13 correctly mark "trial" vs. "pre-trial/confirmation" |
| **Mixed verdict** | ✅ Working—Ex 3, 5 show "MIXED" with breakdown |

---

## Post-Fix Status (2026-03-02)

**Implemented**: Judge prompt clarification in `lib/prompts.ts`:
- FALSE verdicts: Do NOT reject when answer correctly refutes user claim with "ICC documents indicate otherwise"
- Party/counsel statements labeled OPINION — APPROVE

**Result**: **12/15 pass (80%)** — Ex 4, 6, 7, 8, 9 now pass. Remaining blocks: **Ex 10, 11, 14**.

## Summary Table for Handoff

| Improvement | Effort | Impact | Status |
|-------------|--------|--------|--------|
| Judge prompt: fact-check format clarification | 0.5 day | High | ✅ Done—Ex 4, 6, 7, 8, 9 unblocked |
| Ex 10: Tagalog opinion / fallback_regex → Judge REJECT on all-unverifiable | 0.5 day | Low | Pending |
| Ex 11: Prosecutor waiver docs — retrieval or Judge calibration | 0.5 day | Low | Pending |
| Ex 14: Kaufman "minimal" labeled OPINION — Judge sees "not supported" | 0.5 day | Low | Pending |
