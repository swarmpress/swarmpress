# GitHub-Driven Collaboration & Governance Architecture for swarm.press

## 17. GitHub-Driven Collaboration & Governance Architecture

## 17.1 Overview

swarm.press supports a dual interaction model for steering, reviewing, and supervising the autonomous publishing organization:

1. **Internal orchestration layer** — Workflows, agents, Temporal, NATS, database, state machines.
2. **External governance layer** — A transparent human-visible interface for operational oversight.

GitHub can serve as the control plane for agent collaboration, content review, and CEO oversight. All collaboration takes place through:

- GitHub Issues  
- Pull Requests  
- Comments  
- Labels  
- Project Boards  
- GitHub Actions  

GitHub becomes the **auditable, human-centric interface** of the virtual publishing house.

## 17.2 Motivation

Using GitHub as a first-class governance interface offers:

- Full transparency  
- Auditability  
- Standardized collaboration  
- Native human-in-the-loop support  
- LLM-friendly context  
- Zero UI requirements for MVP  
- Integration with GitHub Actions  

## 17.3 GitHub as the Agent Collaboration Surface

GitHub entities map directly to swarm.press concepts:

| GitHub Concept | swarm.press Concept |
|----------------|---------------------|
| Pull Request   | Content Review Workflow |
| Comments       | Editorial feedback, CEO instructions |
| Approvals      | Editorial approval |
| Requests changes | Revision demand |
| Merge          | Publishing decision |
| Issues         | Tasks, QuestionTickets |
| Labels         | Workflow states |
| GitHub Actions | Build & publish pipeline |

A monorepo stores all content, templates, schemas, workflows, and infrastructure configurations.

## 17.4 GitHub Workflow Model

### 17.4.1 Content Creation — WriterAgent
WriterAgent creates a draft PR containing JSON block content.

### 17.4.2 Editorial Review — EditorAgent
EditorAgent reviews content, adds comments, requests changes, or approves.

### 17.4.3 CEO Escalation
High-risk content triggers creation of a GitHub Issue (`question-ticket`) assigned to the CEO.

### 17.4.4 Publishing — EngineeringAgent
EngineeringAgent merges the PR and triggers building and deployment through GitHub Actions.

## 17.5 Pull Request Lifecycle

States:

```
draft → in-review → needs-changes → approved → merged → published
```

Each state maps to a GitHub label.

## 17.6 Issue Lifecycle

GitHub Issues represent:

- Tasks  
- Bugs  
- Content ideas  
- QuestionTickets  

QuestionTickets use `label: question-ticket` and assign to the CEO.

## 17.7 GitHub as Knowledge Base

GitHub stores:

- Historical content  
- PR discussion threads  
- Editorial decisions  
- Templates  
- Patterns and styles  

Agents can learn and reason from the repository.

## 17.8 GitHub Actions Integration

GitHub Actions pipelines automate validation, site-building, and publishing.

## 17.9 Security & Permissions

Agents authenticate as GitHub Apps or fine-grained PATs.

| Agent | Permission Level |
|--------|-------------------|
| WriterAgent | create branches, PRs |
| EditorAgent | review PRs |
| EngineeringAgent | merge PRs, trigger workflows |
| CEOAssistantAgent | manage Issues |
| CEO | admin |

## 17.10 Benefits for the CEO

- Complete transparency  
- Comment directly on PRs  
- Approve or reject content  
- See discussion history  
- All actions visible in one place  

## 17.11 Example PR Workflow

1. WriterAgent drafts article → opens PR  
2. EditorAgent reviews → requests changes  
3. WriterAgent revises → pushes commits  
4. EditorAgent approves  
5. CEO optionally intervenes  
6. EngineeringAgent merges  
7. GitHub Actions publishes site  

## 17.12 Internal vs External State Synchronization

GitHub state syncs with internal PostgreSQL state machines using:

- Webhooks  
- Temporal workflow triggers  
- GitHub API polling  

## 17.13 Conclusion

Using GitHub as the collaboration and governance surface transforms swarm.press into:

> **A transparent, auditable, agent-driven publishing organization where all work is done through Pull Requests, Issues, and Comments.**

This design maximizes transparency, safety, operational efficiency, and human-in-the-loop control.

