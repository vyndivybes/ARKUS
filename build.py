"""Markdown indexer. Python standard library; stable array-index IDs per rebuild."""
import json
import re
from pathlib import Path

STOP = set('a an the is are was were what when where how why who do does did can could should would to of in on for and or my me your you it that this about please tell from with have has i'.split())


def words(text):
    return set(re.findall(r"[\w]+", text.lower())) - STOP


def index_notes(directory):
    root = Path(directory).resolve()
    nodes = []
    for path in sorted(root.rglob('*.md')):
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            continue
        text = path.read_text(encoding='utf-8', errors='replace')[:100000]
        nodes.append(dict(id=len(nodes), label=path.stem.replace('-', ' '),
                          group=path.parent.name, excerpt=text[:700], content=text,
                          file=str(path.relative_to(root)).replace('\\', '/')))
    links = []
    for i, left in enumerate(nodes):
        refs = set(re.findall(r'\[\[([^\]|#]+)', left['content'].lower()))
        for right in nodes[i + 1:]:
            other = set(re.findall(r'\[\[([^\]|#]+)', right['content'].lower()))
            if (right['label'].lower() in left['content'].lower()
                    or left['label'].lower() in right['content'].lower() or refs & other):
                links.append(dict(source=left['id'], target=right['id']))
    return dict(nodes=nodes, links=links)


def public_graph(graph):
    return dict(nodes=[{k: n[k] for k in ('id', 'label', 'group', 'excerpt')} for n in graph['nodes']], links=graph['links'])


def retrieve(graph, question, limit=6):
    query = words(question)
    scored = [(len(query & words(n['label'])) * 5 + len(query & words(n['content'])), n) for n in graph['nodes']]
    return [n for score, n in sorted(scored, key=lambda item: (-item[0], item[1]['id']))[:limit] if score > 0]


def seed(directory):
    root = Path(directory)
    if list(root.rglob('*.md')):
        return
    subjects = {
        'Operations': [('Weekly planning', 'Monday planning sets three outcomes. Friday review checks completed work and blockers.'), ('Customer onboarding', 'Welcome each customer within one business day. Schedule a discovery call and agree the first milestone.'), ('Support hours', 'Support is available Monday through Friday, 9 am to 5 pm India time.'), ('Incident response', 'Acknowledge urgent incidents within 30 minutes and publish a short review after recovery.'), ('Quality checklist', 'Before delivery, check accessibility, data safety, spelling, and the main customer journey.'), ('Supplier review', 'Review supplier reliability and invoices every quarter. Keep a second supplier for critical materials.'), ('Hiring process', 'Use a structured interview, a paid work sample, and two references.'), ('Team standup', 'The standup lasts ten minutes and covers priorities and blockers.'), ('Remote work', 'Write decisions in notes and protect two hours of uninterrupted work each morning.'), ('Data retention', 'Delete test customer data after thirty days. Retain only records required for ongoing work.')],
        'Studio': [('Brand voice', 'Use plain language, warm confidence, and concrete examples. Avoid inflated claims.'), ('Design principles', 'Prioritize readable type, generous spacing, and one clear action per screen.'), ('Website launch', 'Launch requires a mobile review, keyboard navigation, working forms, and a rollback plan.'), ('Content calendar', 'Publish one practical guide on Tuesday and one studio update on Friday.'), ('Photography brief', 'Use natural light, real products, and uncluttered backgrounds.'), ('Research interviews', 'Ask about the last real purchase. Record consent before taking interview notes.'), ('Product roadmap', 'This quarter prioritizes onboarding, reliable search, and customer feedback.'), ('Prototype review', 'Test the prototype with five people before committing to development.'), ('Accessibility review', 'Check contrast, visible focus, labels, reduced motion, and screen reader navigation.'), ('Knowledge garden', 'Link related notes with [[Weekly planning]] and review outdated notes monthly.')],
        'Finance': [('Pricing policy', 'Sample studio projects start at 15000 INR. Quotes specify scope, milestones, and exclusions.'), ('Payment terms', 'Collect fifty percent before starting, and the remainder after delivery.'), ('Cash reserve', 'Maintain three months of operating expenses in reserve.'), ('Invoice checklist', 'Every invoice includes the project name, due date, bank details, and applicable tax information.'), ('Expense review', 'Review subscriptions on the first Monday of each month and cancel unused services.'), ('Revenue goals', 'The fictional sample studio targets 200000 INR monthly recurring revenue.'), ('Refund policy', 'Agree refund terms in writing before work starts. Review complaints individually.'), ('Budget planning', 'Set a quarterly budget and track actual spending each month.'), ('Project margins', 'Estimate labor and direct expenses before accepting a fixed-price project.'), ('Forecast review', 'Update the cash forecast each Friday using confirmed invoices and committed expenses.')]
    }
    for group, entries in subjects.items():
        folder = root / group
        folder.mkdir(parents=True, exist_ok=True)
        for title, body in entries:
            (folder / f'{title}.md').write_text(f'# {title}\n\nFictional sample note. Replace with your own information.\n\n{body}\n\nRelated: [[Weekly planning]]\n', encoding='utf-8')


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('notes', nargs='?', default='data/notes')
    p.add_argument('--seed', action='store_true')
    args = p.parse_args()
    if args.seed:
        seed(args.notes)
    graph = public_graph(index_notes(args.notes))
    Path('viewer/graph-data.js').write_text('const GRAPH = ' + json.dumps(graph) + ';\n', encoding='utf-8')
    print(f"Indexed {len(graph['nodes'])} notes")
