#!/usr/bin/env node
import { runHumanReviewGate } from './i18n-human-review.mjs';

const report = runHumanReviewGate();
if (report.failures.length) process.exitCode = 1;
