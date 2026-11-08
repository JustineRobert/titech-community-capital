import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTNER_GUIDE_CHAPTERS, PARTNER_HELP_DOTS, getGuideChapter, isValidGuideChapterSet } from '../../frontend/src/help/partnerGuide.js';

test('the interactive guide contains exactly seven ordered, substantive chapters', () => {
  assert.equal(isValidGuideChapterSet(), true);
  assert.deepEqual(PARTNER_GUIDE_CHAPTERS.map((chapter) => chapter.number), [1, 2, 3, 4, 5, 6, 7]);
  for (const chapter of PARTNER_GUIDE_CHAPTERS) {
    assert.ok(chapter.tips.length >= 3, `${chapter.id} should include quick tips`);
    assert.ok(chapter.note.length > 20, `${chapter.id} should contain a safety/status note`);
  }
});

test('guide chapter lookup is bounded to the seven configured chapters', () => {
  assert.equal(getGuideChapter(5).id, 'support-tickets');
  assert.equal(getGuideChapter(0), null);
  assert.equal(getGuideChapter(8), null);
});

test('every contextual Help Dot maps to a real guide chapter and UI target', () => {
  for (const dot of PARTNER_HELP_DOTS) {
    assert.ok(getGuideChapter(dot.chapter), `${dot.id} has an existing chapter`);
    assert.ok(dot.target && dot.title && dot.text);
  }
});
