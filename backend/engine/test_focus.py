import unittest
from main import IdeaUpdate, merge_ideas


class DiscussionFocusTests(unittest.TestCase):
    def test_focus_moves_to_new_idea_and_clears_on_unrelated_chunk(self):
        ideas = {"idea-1": {"title": "Old", "summary": "", "is_currently_discussed": True}}
        result, touched = merge_ideas(ideas, [IdeaUpdate(id=None, title="New", summary="", is_currently_discussed=True)])
        self.assertEqual(touched, ["idea-2"])
        self.assertEqual([i for i, idea in result.items() if idea["is_currently_discussed"]], ["idea-2"])
        result, touched = merge_ideas(result, [])
        self.assertEqual(touched, [])
        self.assertFalse(any(idea["is_currently_discussed"] for idea in result.values()))

    def test_return_to_existing_idea_and_single_focus(self):
        ideas = {"idea-1": {"title": "Old", "summary": "", "is_currently_discussed": False}}
        result, touched = merge_ideas(ideas, [
            IdeaUpdate(id=None, title="New", summary="", is_currently_discussed=True),
            IdeaUpdate(id="idea-1", title="Old", summary="More", is_currently_discussed=True),
        ])
        self.assertEqual(touched, ["idea-2", "idea-1"])
        self.assertEqual([i for i, idea in result.items() if idea["is_currently_discussed"]], ["idea-1"])
        self.assertEqual(result["idea-1"]["summary"], "More")


if __name__ == '__main__':
    unittest.main()
