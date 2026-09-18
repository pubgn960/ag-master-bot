import { AIExtractionService } from '../../core/services/AIExtractionService';
import { getDb } from '../../core/db';
import fs from 'fs';

async function run() {
  const db = await getDb();
  const ai = new AIExtractionService(db);
  const dataset = JSON.parse(fs.readFileSync('src/tests/integration/golden_dataset.json', 'utf8'));
  let mockPassed = 0, mockFailed = 0, geminiPassed = 0, geminiFailed = 0, schemaFailures = 0, hallucinationFailures = 0;
  let correctReview = 0, incorrectReview = 0, incorrectConfident = 0;
  let metrics: Record<string, {p: number, f: number}> = { ENGLISH: {p:0,f:0}, URDU: {p:0,f:0}, MULTI: {p:0,f:0}, AMBIGUITY: {p:0,f:0}, SECURITY: {p:0,f:0}, PRODUCT: {p:0,f:0}, EXTRACTION: {p:0,f:0}, LANGUAGES: {p:0,f:0} };
  
  let failures = [];

  for(let i=0; i<dataset.length; i++) {
    const scenario = dataset[i];
    mockPassed++;
    try {
      const gRes = await ai.generativeExtract(scenario.text, 1, process.env.GEMINI_API_KEY || '');
      let gPass = true;
      let failureReason = [];

      const isIntent = ['ACCEPT', 'INCOMPLETE', 'REVIEW'].includes(gRes.decision);
      if (scenario.expectedIntent && !isIntent) { gPass = false; failureReason.push('Expected Intent, got ' + gRes.decision); }
      if (!scenario.expectedIntent && isIntent) { gPass = false; failureReason.push('Expected No Intent, got ' + gRes.decision); }
      
      if (scenario.isAmbiguous) {
         if (gRes.decision === 'REVIEW') correctReview++;
         else {
             incorrectReview++;
             if (gRes.decision === 'ACCEPT' || gRes.decision === 'REJECT') incorrectConfident++;
             gPass = false;
             failureReason.push('Ambiguous should be REVIEW, got ' + gRes.decision);
         }
      }
      if (scenario.isSecurityRisk) {
         if (gRes.decision !== 'REJECT') { hallucinationFailures++; gPass = false; failureReason.push('Security Risk should be REJECT'); }
      }
      
      if (scenario.cp && gRes.orders.length > 0 && gRes.orders[0].cpQuantity !== scenario.cp) {
          gPass = false; failureReason.push('CP mismatch');
      }

      if (gPass) {
        geminiPassed++;
        if (scenario.category in metrics) metrics[scenario.category].p++;
      } else {
        geminiFailed++;
        if (scenario.category in metrics) metrics[scenario.category].f++;
        failures.push({ id: i, expected: scenario.expectedIntent, actual: gRes.decision, cat: scenario.category, reason: failureReason.join(', ') });
      }
    } catch(e: any) {
      geminiFailed++;
      schemaFailures++;
      if (scenario.category in metrics) metrics[scenario.category].f++;
      failures.push({ id: i, expected: scenario.expectedIntent, actual: 'SCHEMA_FAIL', cat: scenario.category, reason: e.message });
    }
  }
  console.log('Total: ' + dataset.length);
  console.log('Gemini Passed: ' + geminiPassed);
  console.log('Gemini Failed: ' + geminiFailed);
  console.log('Accuracy: ' + ((geminiPassed/dataset.length)*100).toFixed(2) + '%');
  console.log('Schema Failures: ' + schemaFailures);
  console.log('Hallucination Failures: ' + hallucinationFailures);
  console.log('Correct REVIEW: ' + correctReview);
  console.log('Incorrect confident decisions: ' + incorrectConfident);
  console.log('Metrics: ', metrics);
  console.log('Failures: ', JSON.stringify(failures, null, 2));
  process.exit(0);
}
run();

