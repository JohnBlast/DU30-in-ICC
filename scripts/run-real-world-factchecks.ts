/**
 * Run real-world fact-check examples through the chat pipeline.
 * Usage: npm run run-real-world-factchecks
 * (or: npx tsx --env-file=.env.local scripts/run-real-world-factchecks.ts)
 */

import { chat } from "../lib/chat";

const EXAMPLES: Array<{ id: number; text: string }> = [
  { id: 1, text: "International Criminal Court (ICC) trial lawyer Edward Jeremy says former president Rodrigo Duterte, as commander-in-chief of the Philippines, incited the crowd to take the life of someone else's child, not for a proven crime, but for a suspected struggle with drug addiction." },
  { id: 2, text: "Former Department of Finance Undersecretary Cielo Magno countered the remarks of Davao City 1st District Representative Paolo Duterte criticizing the International Criminal Court (ICC). Duterte had questioned the ICC's selective focus, saying, \"As bombs fall on Iran, the ICC suddenly turns blind, deaf, and mute. No emergency statements. No dramatic press briefings. No urgency to assert jurisdiction. This silence is not neutrality—it is complicity.\" Magno dismissed Duterte's critique, emphasizing the court's legal mandate: \"Jurisdiction, Polong. Jurisdiction. Huwag madrama.\" The exchange comes amid ongoing discussions about the ICC's investigation into former President Rodrigo Duterte's alleged crimes against humanity during the country's anti-drug campaign from 2011 to 2019." },
  { id: 3, text: "'MR. DUTERTE MUST BE HELD TO ACCOUNT' ICC deputy prosecutor Mame Mandiaye Niang underscored that former president Rodrigo Duterte must be held accountable for his war on drugs campaign to \"bring a sense of justice to the victims.\" \"Unlike Mr. Duterte, who is represented by his counsel here today, they were deprived of any form of due process. The loss of every single one of these victims had the most profound impact on their families, their friends, and ultimately their communities,\" he said in his opening statement at the confirmation of charges hearing on Monday. \"Your Honor, while this court cannot reunite victims with their loved ones, it can help reveal the truth about what happened to them and bring a sense of justice to the victims. The charges before you today are serious, and the evidence submitted required their confirmation. And Mr. Duterte must be held to account, and this case should be confirmed for trial,\" he added. The ICC has set the confirmation of charges hearing for Duterte from February 23 to 27, 2026, moving the pre-trial proceedings forward after months of legal delays." },
  { id: 4, text: "Out of 78 victims cited in 49 drug war killing incidents in former president Rodrigo Duterte's three counts of murder, only five are publicly identified in the International Criminal Court's (ICC) public document. For years, these names attached to a campaign the government called a war on drugs. Now, they appear in evidence before an international court." },
  { id: 5, text: "Prosecutors at the International Criminal Court in The Hague are building their case against former president Rodrigo Duterte by calling a series of protected insider witnesses identified only as \"P\" followed by numbers. During last week's confirmation of charges hearing, they identified at least ten such witnesses in court. Alleged Davao-era enforcers and police officials from the nationwide anti-drug campaign are stepping forward to describe patterns of killings, chains of authorization, and the operational language they say drove thousands of deaths, while the defense challenges their credibility and motives." },
  { id: 6, text: "'HIS CLIENT PREVENTED THAT BY WITHDRAWING THE PHILIPPINES FROM THE ROME STATUTE' ICC Prosecutor Julian Nicholls said former President Rodrigo Duterte is the reason why the ICC can no longer investigate covered crimes in the Philippines that were committed after March 2019, the month when the country's withdrawal from the ICC's Rome Statute took effect. This is in response to Nicholas Kaufman, the former president's legal counsel, when he asked if anyone has thought of investigating President Ferdinand \"Bongbong\" Marcos Jr. as Kaufman claimed that the vigilante killings continued even after Duterte stepped down from office." },
  { id: 7, text: "QUESTIONS THAT THE ICC MUST ANSWER The ICC moved against President Rodrigo Roa Duterte in 2023 — five (5) years after the Philippines had already withdrawn from the Rome Statute. Five years after we left. That alone raises serious questions about jurisdiction, sovereignty, and motive. Now, sworn statements from former military personnel who served as security escorts detail how this entire case was constructed on the ground. According to their affidavit, witnesses were not independently sourced. They were identified, prepared, and funneled through political intermediaries — particularly former Senator Antonio Trillanes IV. Interviews were reportedly pre-arranged. Narratives coordinated." },
  { id: 8, text: "#THE CONTRADICTIONS AND HYPOCRISY IN THE CLOSING ARGUMENTS OF GILBERT ANDRES Gilbert Andres framed his closing statement on the narrative that Rodrigo Duterte killed poor people. That the former President is guilty of killing thousands, without proof that he ordered a hit on one specific person. He relied on the concept that everything that the President says is policy but skips that part of his speeches that says the use of force may be applied only when the life of the police is in danger. If Duterte wants to kill poor people, then why did he rush to help the victims of Yolanda when PNOY said that every calamity, even if one is of an epic proportion, is the statutory job of the local government? Mar Roxas even gave that infamous explanation for the delay, saying that it's because the Mayor of Tacloban is a Romualdez and the President is an Aquino. Is Duterte the nemesis of the poor when it was PNOY who vetoed the additional 1,000 peso pension for poor SSS retirees? There's a reason why the poor loved the former President. He is not the monster that Andres portrays him to be. His high trust ratings are easy to explain. The Filipino people loved him. It is the oligarchy that hates him for having challenged for the first time their control of the lives of the Filipino people. Andres simply lumps together all these EJK incidents to make it appear that all these killings came from the order of one man. But there's none. Citing a case decided by the ICC, he said that orders are not a requisite to prove that someone has committed crimes against humanity. If that is so, then why does he insist that killing drug suspects is state policy in the Philippines? This is a clear contradiction that hopefully will not escape the scrutiny of the ICC judges because in reality, there was no policy of murder. A President cannot make a rule that is contrary to law or public morals. If indeed not a single drug related case was prosecuted, how come the SC decided with finality the case of Kian delos Santos? In truth, Andres is simply advancing the elite-driven narrative against Duterte, one that is rooted in their hatred because the former President buried the liberals in the mud, people who proudly display their self-moralizing ways as they sit on a moral high chair, without realizing that it is not Duterte that is being tried at The Hague, but the Filipino people. Just like the tragedy of the Philippine Revolution, these Filipinos are condemning one of their own at the behest of their colonial masters. Andres is seeking justice for what he claims is a criminal act of targeting the poor, but his sermon like presentation, easily a disguise for the failure of the elite in the country to give to the poor what they are due, is nothing but a masquerade for the inefficiencies of our justice system, but not its inability to act. The elites in the country are trying to paint an image of Duterte as someone who is anti-poor when in reality, the people loved him for being authentic. To put these things in a broad light and into a global perspective, let us again be reminded of the real meaning of impunity. Last night, as US and Israeli planes bombed Iran, one can't help but think how hypocritical the ICC is. A Israeli bomb hit a school for girls, killing 50 children, reports say. Trump and Netanyahu have premised the war on one thing - that Iran poses an existential threat to Israel. And so Netanyahu, with the aid of US military might, continues with his murderous ways. Andres forgets that the ICC is supposed to be a court of last resort. That if the Filipino people must desire justice, then it can only be rooted in their sovereign will, not the dictates of a tribunal that has not done anything against powerful men who openly brag how successful their military has killed thousands. Duterte at The Hague has not blemished his legacy. In fact, his enemies have made him a hero. But we are guilty of repeating history. Just another story of tragedy in our history as a nation." },
  { id: 9, text: "ICC GRANTS DUTERTE'S WAIVER OF ATTENDANCE JUST IN: The International Criminal Court Pre-Trial Chamber I has granted former President Rodrigo Duterte's request to waive his right to attend the annual hearing on his detention set for Feb. 27 in The Hague. In a decision dated Feb. 25, the chamber said Duterte understood the consequences of his waiver and ruled that the hearing will proceed in his absence." },
  { id: 10, text: "As an ordinary Filipino, pinanood ko ang Confirmation of Charges ni Duterte sa ICC. Hindi ko man natapos, malinaw sa akin ang isang bagay, may kirot at hiya bilang Pilipino sa mga nangyayari ngayon. Masakit tanggapin na dayuhan ang huhusga, samantalang hindi naman nila lubos nararamdaman ang realidad ng bansa natin. Ibang klase talaga ang galaw ng politika at power sa mundo. Madalas, hindi lang ito tungkol sa batas, kundi sa impluwensya, interes, at kontrol sa totoong kwento. Sa huli, hindi lang pangalan ng isang tao ang nadadawit, kundi dangal ng buong Pilipinas. Oo, hindi man ganon kaunlad ang bansa natin kumpara sa iba, pero hindi tayo bulag o tanga. Ang tunay na hustisya, hindi dapat hawak ng banyaga. Kung kulang ang pagkaunawa nila sa totoong sitwasyon natin, bakit sa dayuhan tayo maniniwala?" },
  { id: 11, text: "ICC PROSECUTOR: DUTERTE'S CLAIMS 'AN OUTRAGEOUS LIE' UPDATE: The ICC prosecutor has opposed former president Rodrigo Duterte's request to waive his right to attend his confirmation of charges hearing, asking pre-trial judges to deny the appeal and order him to appear in person. Prosecutors said Duterte cannot unilaterally excuse himself and that it is up to the Chamber to decide whether there is cause to hold the hearing in his absence. Prosecutors added Duterte's refusal to recognize the court's jurisdiction, his claim that the charges are an \"outrageous lie,\" and assertions that he is \"old, tired, and frail\" do not justify non-appearance" },
  { id: 12, text: "ICC COUNSEL FOR VICTIMS: DUTERTE DAPAT LITISIN, MANATILI SA DETENTION Naniniwala si Paolina Massidda, principal counsel of the independent Office of Public Counsel for Victims (OPCV), na may sapat na basehan at ebidensya para umusad ang paglilitis laban kay dating Pangulong Rodrigo Duterte. Tinutulan din ni Massida ang mga argumento ni defense counsel Nicholas Kaufman pagdating sa nanlaban cases at mga kabataang biktima ng drug war. Hiling din nilang huwag pagbigyan ang interim release ng dating pangulo. Narito ang panayam kay Massidda." },
  { id: 13, text: "DUTERTE: I AM OLD, TIRED, AND FRAIL BREAKING: Former president Rodrigo Duterte has waived his right to attend his confirmation of charges hearing at the International Criminal Court next week, saying he does not recognize the tribunal's jurisdiction and no longer wishes to take part in the proceedings. In a signed letter dated February 17, Duterte wrote, \"I do not wish to attend legal proceedings that I will forget within minutes.\" He described himself as \"old, tired, and frail,\" and asked the court to \"respect my peace inside the cell it has placed me.\" Duterte said he has accepted the fact that he could die in prison" },
  { id: 14, text: "Kaufman disputes the ICC prosecution's data on drug personalities killed in Duterte's anti-drug operations. He stated that the number of deaths is \"minimal,\" citing the data chart he presented." },
  { id: 15, text: "Children as young as 3 were killed in the drug war—some asleep, some getting ready for school. As the ICC case against Duterte moves forward, families want accountability for lives lost too soon." },
];

interface RunResult {
  id: number;
  gotPerClaimBreakdown: boolean;
  isBlocked: boolean;
  blockReason?: string;
  claimCount?: number;
  verdicts?: string[];
  answerPreview: string;
  error?: string;
}

async function main() {
  console.log("Running real-world fact-check examples...\n");
  const results: RunResult[] = [];

  for (const ex of EXAMPLES) {
    process.stdout.write(`Example ${ex.id}: `);
    try {
      const result = await chat({
        query: "Is this accurate? Fact-check this.",
        pastedText: ex.text,
        conversationHistory: [],
      });

      const isBlocked =
        result.answer.includes("couldn't verify this fact-check") ||
        result.answer.includes("couldn't find relevant ICC documents") ||
        result.answer.includes("no verifiable factual claims");

      const gotPerClaimBreakdown =
        !isBlocked &&
        (result.answer.includes("•") || /\b(VERIFIED|FALSE|UNVERIFIABLE|OPINION)\b/i.test(result.answer));

      const claimCount = result.factCheck?.claims?.length;
      const verdicts = result.factCheck?.claims?.map((c) => c.verdict);

      let blockReason: string | undefined;
      if (isBlocked) {
        if (result.answer.includes("couldn't verify")) blockReason = "generic_block";
        else if (result.answer.includes("couldn't find relevant")) blockReason = "no_chunks";
        else if (result.answer.includes("no verifiable factual claims")) blockReason = "no_claims";
      }

      results.push({
        id: ex.id,
        gotPerClaimBreakdown,
        isBlocked,
        blockReason,
        claimCount,
        verdicts,
        answerPreview: result.answer.slice(0, 300) + (result.answer.length > 300 ? "…" : ""),
      });

      console.log(
        isBlocked
          ? `BLOCKED (${blockReason ?? "?"})`
          : `OK — ${claimCount ?? "?"} claims: ${verdicts?.join(", ") ?? "—"}`
      );
    } catch (e) {
      results.push({
        id: ex.id,
        gotPerClaimBreakdown: false,
        isBlocked: true,
        blockReason: "error",
        error: e instanceof Error ? e.message : String(e),
        answerPreview: "",
      });
      console.log("ERROR:", e instanceof Error ? e.message : String(e));
    }
  }

  // Summary & analysis
  console.log("\n" + "=".repeat(60));
  console.log("ANALYSIS");
  console.log("=".repeat(60));

  const blocked = results.filter((r) => r.isBlocked);
  const ok = results.filter((r) => !r.isBlocked);

  console.log(`\nBlocked: ${blocked.length}/${results.length}`);
  console.log(`Answered with per-claim breakdown: ${ok.length}/${results.length}`);

  if (blocked.length > 0) {
    console.log("\nBlocked examples:");
    for (const r of blocked) {
      console.log(`  ${r.id}: ${r.blockReason ?? r.error} — ${r.answerPreview.slice(0, 80)}…`);
    }
  }

  console.log("\n--- Full results (answer preview) ---\n");
  for (const r of results) {
    console.log(`\n### Example ${r.id} ###`);
    console.log(r.answerPreview);
    if (r.verdicts?.length) console.log("Verdicts:", r.verdicts.join(", "));
  }
}

main().catch(console.error);
