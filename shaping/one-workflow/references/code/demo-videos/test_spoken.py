"""The rules the rig applies to text, on both sides of a narration.

Run with ./test.sh — no model download, no audio, seconds rather than minutes.
"""

import unittest

from narration.audio import split_for_synthesis
from narration.spoken import spoken_words
from transcribe import compare


class SpokenFormTest(unittest.TestCase):
    def assertSameSpoken(self, written: str, transcribed: str, language: str = 'en'):
        self.assertEqual(
            spoken_words(written, language), spoken_words(transcribed, language)
        )

    def test_a_transcriber_writing_numerals_is_not_a_difference(self):
        self.assertSameSpoken('two hundred and forty kilograms', '240 kilograms')
        self.assertSameSpoken('one hundred and eighty', '180')
        self.assertSameSpoken('twelve cents', '12 cents')
        self.assertSameSpoken('thirty-one', '31')

    def test_decimals_survive_both_spellings(self):
        self.assertSameSpoken('two hundred thirty-one point five', '231.5')
        self.assertSameSpoken('four point zero', '4.0')

    def test_identifiers_read_the_same_hyphenated_or_not(self):
        self.assertSameSpoken('run PR-7 used revision V17', 'run PR7 used revision V17')

    def test_symbols_read_as_their_words(self):
        self.assertSameSpoken('about a four percent loss', 'about a 4% loss')
        self.assertSameSpoken('four euros', '4 €')

    def test_punctuation_and_casing_are_not_differences(self):
        self.assertSameSpoken(
            'It opens on drafts, because that is where the work is.',
            'it opens on drafts because that is where the work is',
        )

    def test_a_wrong_word_is_still_a_difference(self):
        check = compare('the batch yield reads 240 kilograms', 'the batch yield reads 240 pounds')
        self.assertLess(check['wordAccuracy'], 1.0)
        self.assertEqual(
            check['differences'], [{'expected': 'kilograms', 'heard': 'pounds'}]
        )

    def test_a_dropped_sentence_is_still_a_difference(self):
        check = compare('First line. Second line.', 'First line.')
        self.assertLess(check['wordAccuracy'], 1.0)

    def test_portuguese_numbers_read_as_digits(self):
        self.assertSameSpoken('duzentos e quarenta quilos', '240 quilos', 'pt')
        self.assertSameSpoken('duzentos e trinta e um', '231', 'pt')
        self.assertSameSpoken('mil e quinhentos', '1500', 'pt')
        self.assertSameSpoken('dois milhões', '2000000', 'pt')
        self.assertSameSpoken('quatro vírgula cinco', '4,5', 'pt')
        self.assertSameSpoken('um e meio', '1,5', 'pt')

    def test_a_language_without_numerals_still_compares_words(self):
        check = compare('das Rezept ist offen', 'das Rezept ist offen', 'de')
        self.assertEqual(check['wordAccuracy'], 1.0)

    def test_matching_narration_scores_perfectly(self):
        check = compare('Revision V17 yields 240 kg.', 'revision v17 yields 240 kg')
        self.assertEqual(check['wordAccuracy'], 1.0)
        self.assertEqual(check['differences'], [])


class ChunkingTest(unittest.TestCase):
    def assertWithin(self, chunks: list[str], budget: int):
        for chunk in chunks:
            self.assertLessEqual(len(chunk), budget, f'over budget: {chunk!r}')

    def test_short_narration_is_one_breath(self):
        self.assertEqual(
            split_for_synthesis('The recipe list opens on drafts.', 280),
            ['The recipe list opens on drafts.'],
        )

    def test_sentences_group_up_to_the_budget(self):
        chunks = split_for_synthesis('Aaa bbb ccc. Ddd eee fff. Ggg hhh iii.', 26)
        self.assertEqual(chunks, ['Aaa bbb ccc. Ddd eee fff.', 'Ggg hhh iii.'])

    def test_a_sentence_too_long_to_say_breaks_at_its_clauses(self):
        sentence = (
            'The recipe carries a history, the history names every revision, '
            'and the run records which revision it cooked.'
        )
        chunks = split_for_synthesis(sentence, 70)
        self.assertWithin(chunks, 70)
        self.assertTrue(chunks[0].endswith(','))
        self.assertEqual(' '.join(chunks), sentence)

    def test_a_clause_too_long_to_say_still_fits(self):
        sentence = ' '.join(['word'] * 60) + '.'
        chunks = split_for_synthesis(sentence, 80)
        self.assertWithin(chunks, 80)
        self.assertEqual(' '.join(chunks), sentence)

    def test_nothing_to_say_is_no_chunks(self):
        self.assertEqual(split_for_synthesis('   \n  ', 280), [])

    def test_no_word_is_lost_or_reordered(self):
        text = (
            'Let me show you what changed. Before this, a recipe lived in a '
            'spreadsheet; nobody could tell you which one was current. So we '
            'made it a record, with a history you can read.'
        )
        self.assertEqual(' '.join(split_for_synthesis(text, 90)).split(), text.split())


if __name__ == '__main__':
    unittest.main()
