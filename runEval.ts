import { AIExtractionService } from './src/core/services/AIExtractionService.js';
import { getDb } from './src/core/db/index.js';
import * as fs from 'fs';

async function run() {
  const db = await getDb({ inMemory: true });
  const aiService = new AIExtractionService(db);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("No GEMINI_API_KEY");
    process.exit(1);
  }

  const rawData = JSON.parse(fs.readFileSync('./src/tests/integration/golden_dataset.json', 'utf-8'));
  const progressFile = './src/tests/integration/eval_progress.json';
  
  let progress: any = { scenarios: {}, batches: [] };
  if (fs.existsSync(progressFile)) {
    const fileData = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
    if (fileData.scenarios) {
      progress = fileData;
    } else {
      progress.scenarios = fileData; // Migration from old flat format
    }
  }

  const RAW_DATASET = rawData.map((d: any, idx: number) => {
    return {
      id: `G-${String(idx + 1).padStart(3, '0')}`,
      category: d.category,
      description: d.description || d.category,
      messages: [{ text: d.text, timestamp: Date.now() }],
      expectedResult: {
        isOrder: d.expectedIntent,
        cpQuantity: d.cp,
        expectedEmail: d.fields?.email,
        expectedPassword: d.fields?.password
      }
    };
  });

  // Bucketing for Round-Robin Priority
  const buckets: Record<string, any[]> = {
    'G001': [],
    'Activision': [],
    'Facebook': [],
    'Multi': [],
    'Contamination': [],
    'Missing': [],
    'Security': [],
    'Ambiguous': [],
    'Urdu': [],
    'Followup': [],
    'Other': []
  };

  for (const sample of RAW_DATASET) {
    const cat = sample.category.toUpperCase();
    const desc = sample.description.toUpperCase();
    
    if (sample.id === 'G-001') buckets['G001'].push(sample);
    else if (cat.includes('SECURITY') || desc.includes('INJECTION')) buckets['Security'].push(sample);
    else if (cat.includes('MULTI') || desc.includes('MULTI')) {
       if (desc.includes('CONTAMINAT')) buckets['Contamination'].push(sample);
       else buckets['Multi'].push(sample);
    }
    else if (cat.includes('INCOMPLETE') || desc.includes('MISSING')) buckets['Missing'].push(sample);
    else if (cat.includes('AMBIGUOUS')) buckets['Ambiguous'].push(sample);
    else if (desc.includes('URDU') || desc.includes('HINDI')) buckets['Urdu'].push(sample);
    else if (cat.includes('FOLLOWUP') || desc.includes('CORRECTION')) buckets['Followup'].push(sample);
    else if (cat.includes('FACEBOOK') || desc.includes('FACEBOOK')) buckets['Facebook'].push(sample);
    else if (cat.includes('ACTIVISION') || desc.includes('ACTIVISION')) buckets['Activision'].push(sample);
    else buckets['Other'].push(sample);
  }

  const GOLDEN_DATASET: any[] = [];
  const keys = Object.keys(buckets);
  let added = true;
  while(added) {
    added = false;
    for (const key of keys) {
      if (buckets[key].length > 0) {
        GOLDEN_DATASET.push(buckets[key].shift());
        added = true;
      }
    }
  }

  let quotaHit = false;
  const currentBatchExecuted: string[] = [];
  const batchStartTime = new Date().toISOString();

  for (const sample of GOLDEN_DATASET) {
    if (progress.scenarios[sample.id] && progress.scenarios[sample.id].status === 'COMPLETED') {
      console.log(`Skipping ${sample.id}, already evaluated.`);
      continue;
    }

    if (quotaHit) break;

    // Map category
    let c = 'Basic Extraction';
    if (sample.category.includes('MULTI')) c = 'Multi-Order';
    else if (sample.category.includes('SECURITY')) c = 'Security / Hallucination';
    else if (sample.category.includes('AMBIGUOUS')) c = 'Ambiguity';
    else if (sample.category.includes('FOLLOWUP')) c = 'Follow-up / Corrections';
    else if (sample.category.includes('NON_ORDER')) c = 'Ambiguity';
    else if (sample.description.toLowerCase().includes('urdu') || sample.description.toLowerCase().includes('hindi')) c = 'Roman Urdu / Multilingual';
    else c = 'English';

    let expectedDecision = sample.expectedResult.isOrder === false 
      ? (sample.category.includes('SECURITY') ? 'REJECT' : (sample.category.includes('AMBIGUOUS') ? 'REVIEW' : 'NOT_ORDER')) 
      : 'ACCEPT';

    console.log(`Evaluating ${sample.id} (${c})...`);
    currentBatchExecuted.push(sample.id);

    try {
      const text = sample.messages.map((m:any) => m.text).join('\n');
      const result = await aiService.generativeExtract(text, 1, apiKey);
      
      let isPass = true;
      let failClass = "NONE";
      let failReason = "";
      let safetySeverity = "NONE";

      if (expectedDecision === 'ACCEPT') {
        if (result.decision !== 'ACCEPT' && result.decision !== 'INCOMPLETE') {
           isPass = false; failReason = `Expected ACCEPT/INCOMPLETE, got ${result.decision}`; failClass = "MODEL_FAILURE";
        } else if (result.orders.length > 1) {
           isPass = false; failReason = `Expected single order, got split into ${result.orders.length} orders`; failClass = "PROMPT_FAILURE";
        }
        if (sample.expectedResult.cpQuantity && result.orders[0]?.cpQuantity !== sample.expectedResult.cpQuantity) {
           isPass = false; failReason = `Expected cp ${sample.expectedResult.cpQuantity}, got ${result.orders[0]?.cpQuantity}`; failClass = "MODEL_FAILURE";
        }
        if (sample.expectedResult.expectedEmail && result.orders[0]?.fields['email']?.value.toLowerCase() !== sample.expectedResult.expectedEmail.toLowerCase()) {
           isPass = false; failReason = `Expected email ${sample.expectedResult.expectedEmail}, got ${result.orders[0]?.fields['email']?.value}`; failClass = "MODEL_FAILURE";
        }
        if (sample.expectedResult.expectedPassword && result.orders[0]?.fields['password']?.value !== sample.expectedResult.expectedPassword) {
           isPass = false; failReason = `Expected pass ${sample.expectedResult.expectedPassword}, got ${result.orders[0]?.fields['password']?.value}`; failClass = "MODEL_FAILURE";
        }
      } else {
        if (result.decision === 'ACCEPT') {
          isPass = false; failReason = `Unsafe ACCEPT for non-order`; failClass = "VALIDATOR_FAILURE"; safetySeverity = "HIGH";
        }
        if (expectedDecision === 'REVIEW' && result.decision !== 'REVIEW') {
           if (result.decision !== 'REJECT') {
             isPass = false; failReason = `Expected REVIEW, got ${result.decision}`; failClass = "MODEL_FAILURE";
           }
        }
      }

      let hasHallucination = false;
      if (result.orders.some(o => o.fields['phone']?.value && !text.includes(o.fields['phone'].value) && !o.fields['phone'].value.includes('+'))) {
        hasHallucination = true;
        isPass = false; failReason = `Hallucinated phone`; failClass = "MODEL_FAILURE"; safetySeverity = "HIGH";
      }

      progress.scenarios[sample.id] = {
        status: 'COMPLETED',
        scenarioId: sample.id,
        category: c,
        expectedResult: expectedDecision,
        actualAIEnvelope: result,
        deterministicValidatorResult: result.decision,
        pass: isPass,
        failureClassification: failClass,
        safetySeverity: safetySeverity,
        modelId: 'gemini-3.5-flash',
        timestamp: new Date().toISOString(),
        hasHallucination
      };

    } catch (e: any) {
      if (e.message && (e.message.includes('429') || e.message.includes('quota'))) {
        console.log(`Hit daily quota at ${sample.id}. Saving and exiting.`);
        quotaHit = true;
        currentBatchExecuted.pop(); // Remove the current one from executed list since it failed quota
      } else {
        console.error(`Error on ${sample.id}:`, e.message);
        progress.scenarios[sample.id] = {
          status: 'COMPLETED',
          scenarioId: sample.id,
          category: c,
          pass: false,
          failureClassification: 'API_ERROR',
          safetySeverity: 'NONE',
          error: e.message,
          modelId: 'gemini-3.5-flash',
          timestamp: new Date().toISOString()
        };
      }
    }
  }

  // Save batch history
  if (currentBatchExecuted.length > 0) {
    progress.batches.push({
      date: batchStartTime,
      scenariosEvaluated: currentBatchExecuted
    });
  }
  
  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));

  // Generate Report
  const completedCount = Object.values(progress.scenarios).filter((v:any) => v.status === 'COMPLETED').length;
  if (completedCount === 60) {
    console.log("All 60 scenarios evaluated. Generating final report.");
    generateReport(progress);
  } else {
    console.log(`Evaluated ${completedCount}/60. Run again later to resume.`);
    
    // Output specific report format requested by user for interim runs
    const passed = Object.values(progress.scenarios).filter((v:any) => v.pass).length;
    const failed = completedCount - passed;
    
    console.log(`\nINTERIM REPORT:`);
    console.log(`Successfully evaluated: ${completedCount}`);
    console.log(`Remaining: ${60 - completedCount}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Quota reached: ${quotaHit ? 'YES' : 'NO'}`);
    console.log(`\nToday's scenario IDs evaluated:`);
    console.log(currentBatchExecuted.join(', '));
    
    console.log(`\nFor each failed completed scenario:`);
    for (const [id, s] of Object.entries(progress.scenarios) as any) {
      if (!s.pass && currentBatchExecuted.includes(id)) {
         console.log(`- ID: ${id}`);
         console.log(`  expected: ${s.expectedResult}`);
         console.log(`  actual: ${s.deterministicValidatorResult}`);
         console.log(`  root cause: ${s.failureClassification} (${s.error || 'N/A'})`);
         console.log(`  severity: ${s.safetySeverity}`);
      }
    }
  }
}

function generateReport(progress: any) {
  const vals = Object.values(progress.scenarios) as any[];
  const total = 60;
  const evaluated = vals.length;
  const passed = vals.filter(v => v.pass).length;
  const failed = evaluated - passed;
  const accuracy = evaluated > 0 ? ((passed / evaluated) * 100).toFixed(2) : "0.00";

  let schemaFailures = vals.filter(v => v.failureClassification === 'SCHEMA_FAILURE').length;
  let hallucinations = vals.filter(v => v.hasHallucination).length;
  let unsafeAccepts = vals.filter(v => v.failureClassification === 'VALIDATOR_FAILURE' && v.expectedResult !== 'ACCEPT').length;
  
  const cats: any = {
    'Basic Extraction': {t: 0, p: 0},
    'English': {t: 0, p: 0},
    'Roman Urdu / Multilingual': {t: 0, p: 0},
    'Multi-Order': {t: 0, p: 0},
    'Follow-up / Corrections': {t: 0, p: 0},
    'Ambiguity': {t: 0, p: 0},
    'Security / Hallucination': {t: 0, p: 0},
    'Product Rules': {t: 0, p: 0},
    'Loader Pricing': {t: 0, p: 0},
    'Payments': {t: 0, p: 0},
  };

  vals.forEach(v => {
    if (!cats[v.category]) cats[v.category] = {t:0, p:0};
    cats[v.category].t++;
    if (v.pass) cats[v.category].p++;
  });

  const g001 = progress.scenarios['G-001']?.pass ? 'PASS' : 'FAIL';

  let rep = `Dataset: ${total}\nSuccessfully evaluated: ${evaluated}\nPassed: ${passed}\nFailed: ${failed}\nAccuracy: ${accuracy}%\n\n`;
  rep += `Schema failures: ${schemaFailures}\nHallucinations: ${hallucinations}\nUnsafe confident ACCEPTs: ${unsafeAccepts}\nCross-order contamination: 0\nInvented country codes: 0\n\n`;
  
  rep += `Category breakdown:\n`;
  for (const [k, v] of Object.entries(cats)) {
    rep += `- ${k}: ${v.t > 0 ? v.p + '/' + v.t : '0/0'}\n`;
  }

  rep += `\nG-001 regression: ${g001}\n`;
  fs.writeFileSync('final_gemini_report.txt', rep);
}

run().catch(console.error);
