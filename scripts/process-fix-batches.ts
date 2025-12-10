/**
 * Process the 3 fix batches for broken collection files
 */
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';

const client = new Anthropic();

async function processFixBatches() {
  const batches = [
    { id: 'msgbatch_012Eoi3qu8QfELuThV5JaWJa', collection: 'accommodations', village: 'monterosso' },
    { id: 'msgbatch_01Cic9DQq8Dt6YMtHPFxm3WL', collection: 'accommodations', village: 'vernazza' },
    { id: 'msgbatch_011adKc7AZxBbDxJ4x5hPGAp', collection: 'restaurants', village: 'corniglia' }
  ];

  for (const batch of batches) {
    console.log('\n=== Processing', batch.collection, '-', batch.village, '===');

    // Get results URL
    const batchInfo = await client.beta.messages.batches.retrieve(batch.id);

    if (batchInfo.processing_status !== 'ended' || !batchInfo.results_url) {
      console.log('Batch not ready yet');
      continue;
    }

    // Download results
    const response = await fetch(batchInfo.results_url);
    const text = await response.text();

    // Parse JSONL
    const lines = text.split('\n').filter(Boolean);

    for (const line of lines) {
      const result = JSON.parse(line);

      if (result.result?.type === 'succeeded') {
        const message = result.result.message;
        const content = message.content[0]?.text;

        if (content) {
          // Try to parse as JSON
          try {
            const jsonData = JSON.parse(content);

            // Save to appropriate location
            const outputDir = '.batch-output/' + batch.collection;
            const outputPath = path.join(outputDir, batch.village + '.json');

            fs.mkdirSync(outputDir, { recursive: true });
            fs.writeFileSync(outputPath, JSON.stringify(jsonData, null, 2));

            console.log('✓ Saved to', outputPath);
            console.log('  Items:', jsonData.items?.length || 0);
          } catch (e) {
            // Try to extract JSON from content
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                const jsonData = JSON.parse(jsonMatch[0]);
                const outputDir = '.batch-output/' + batch.collection;
                const outputPath = path.join(outputDir, batch.village + '.json');

                fs.mkdirSync(outputDir, { recursive: true });
                fs.writeFileSync(outputPath, JSON.stringify(jsonData, null, 2));

                console.log('✓ Saved to', outputPath);
                console.log('  Items:', jsonData.items?.length || 0);
              } catch (e2) {
                // Save raw
                const outputDir = '.batch-output/fixes';
                fs.mkdirSync(outputDir, { recursive: true });
                fs.writeFileSync(outputDir + '/' + batch.village + '-' + batch.collection + '-raw.txt', content);
                console.log('! Saved raw to fixes folder (JSON parse failed)');
                console.log('  First 500 chars:', content.substring(0, 500));
              }
            } else {
              // Save raw
              const outputDir = '.batch-output/fixes';
              fs.mkdirSync(outputDir, { recursive: true });
              fs.writeFileSync(outputDir + '/' + batch.village + '-' + batch.collection + '-raw.txt', content);
              console.log('! Saved raw to fixes folder (no JSON found)');
              console.log('  First 500 chars:', content.substring(0, 500));
            }
          }
        }
      } else {
        console.log('Failed:', result.result?.error || 'Unknown error');
      }
    }
  }
}

processFixBatches().catch(console.error);
