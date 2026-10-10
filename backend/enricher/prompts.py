import json


def build_analysis_prompt(idea: dict, discussion: str) -> str:
    return f"""You are the critical analyst of a live brainstorming session. A team is talking, and their speech is transcribed in real time without speaker names.

IDEA:
{json.dumps({"title": idea["title"], "summary": idea["summary"]}, indent=2, ensure_ascii=False)}

DISCUSSION OF THIS IDEA SO FAR (transcript excerpts, oldest first):
{discussion}

Analyze only this idea, using only what the team said. Never invent features, numbers or consensus.

- `summary`: 2 to 4 sentences synthesizing the debate about the idea: what the team likes, what worries them, where they stand.
- `conclusion`: one sentence with the most important decision so far, or the main unresolved next step.
- `pros` and `cons`: every material benefit and objection voiced. `point` is one concise sentence. `category` is one of Technical, Business & Market, User Experience, Operations, Compliance & Security, Financial. `severity_or_impact` is High, Medium or Low. Sort each list by impact, highest first. Return empty lists if nothing was voiced.

Write in the language of the transcript.
"""


def build_competitors_prompt(idea: dict) -> str:
    return f"""Search the web for existing products and companies that compete with this idea from a brainstorming session.

IDEA:
{json.dumps({"title": idea["title"], "summary": idea["summary"]}, indent=2, ensure_ascii=False)}

- `market_landscape`: 2 to 3 sentences on the current market for this idea.
- `competitors`: up to 4 real, currently operating products or companies, most relevant first. `name` is the product or company name, `summary` one sentence on what it does, `differentiator` one sentence on how this idea differs from it.

Only include competitors you found in the search results. Return an empty list if there are none.
"""
