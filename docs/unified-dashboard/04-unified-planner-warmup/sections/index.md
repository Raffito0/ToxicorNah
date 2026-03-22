<!-- PROJECT_CONFIG
runtime: python-pip
test_command: pytest
END_PROJECT_CONFIG -->

<!-- SECTION_MANIFEST
section-01-planner-parameterization
section-02-warmup-interleaving
section-03-planner-service
section-04-api-routes
section-05-timeline-frontend
section-06-warmup-panel
section-07-executor-db-integration
section-08-status-polling
END_MANIFEST -->

# Implementation Sections Index

## Dependency Graph

| Section | Depends On | Blocks | Parallelizable |
|---------|------------|--------|----------------|
| section-01-planner-parameterization | - | 02, 03 | Yes |
| section-02-warmup-interleaving | 01 | 03 | No |
| section-03-planner-service | 01, 02 | 04, 05, 06, 07, 08 | No |
| section-04-api-routes | 03 | 05, 06, 08 | Yes |
| section-05-timeline-frontend | 04 | 08 | Yes |
| section-06-warmup-panel | 04 | - | Yes |
| section-07-executor-db-integration | 03 | 08 | Yes |
| section-08-status-polling | 05, 07 | - | No |

## Execution Order

1. section-01-planner-parameterization (no dependencies)
2. section-02-warmup-interleaving (after 01)
3. section-03-planner-service (after 01 AND 02)
4. section-04-api-routes, section-05-timeline-frontend, section-06-warmup-panel, section-07-executor-db-integration (parallel after 03, though 05/06 need 04 for API endpoints)
5. section-08-status-polling (final -- needs timeline + executor)

## Section Summaries

### section-01-planner-parameterization
Refactor scheduler.py, rules_engine.py, personality.py to accept accounts as parameter instead of reading config.ACCOUNTS. Remove file I/O for personality state. Derive PHONES from accounts. All 7 functions listed in plan section 2.1 updated. Tests: verify plan generation works with dynamic account lists of varying sizes.

### section-02-warmup-interleaving
Add warmup awareness to _build_session() and the daily plan generation flow. New session types: warmup, warmup_lazy. Dead days return None (skipped). Engagement caps dict in session output. Warmup accounts limited to 1 session/day. Cap values read from warmup_plan dict. Tests: mixed warmup + regular plans have correct session types and caps.

### section-03-planner-service
Create app/planner_service.py wrapping planner with DB integration. sys.path setup for planner import. Account query from BotAccount -> Bot -> Phone joined by proxy_id. Timezone conversion (Eastern -> UTC at DB boundary). UPSERT for WeeklyPlan storage. Field name mapping (account -> account_name, type -> session_type). Deterministic session_id generation. Personality state round-trip via DB. Warmup service functions. SQLite WAL mode. Tests: end-to-end plan generation through service layer with DB storage.

### section-04-api-routes
Create app/planner_routes.py blueprint with /api/planner prefix. All 9 endpoints from plan section 4.1. @login_required on all routes. Template route for /weekly-plan page. JSON response formats per plan section 4.2. Error handling (400 on planner errors, 404 for missing plans). Tests: all endpoints return correct status codes and response shapes.

### section-05-timeline-frontend
Create weekly-plan.html (Jinja2 template), weekly-plan.js, weekly-plan.css. Today's Timeline tab with vertical 24h layout. Session blocks positioned by start/end time. Platform colors (TikTok blue, Instagram pink). Warmup sessions with dashed border. Click-to-detail modal. Current time marker (red line). Week Overview tab with 7-column grid. Week navigation. Generate/Regenerate/Download JSON buttons.

### section-06-warmup-panel
Warmup summary cards on Weekly Plan page (progress bar, day type badge). Full warmup controls in Phone Settings (reset, skip, mark complete, caps display, profile pic/bio status). POST to /api/planner/warmup endpoints.

### section-07-executor-db-integration
Modify executor.py to read plans from WeeklyPlan table instead of JSON files. Modify warmup.py to read/write BotAccount.warmup_json instead of warmup_state.json. Executor writes deterministic session_id to SessionLog on start/end. UTC -> Eastern conversion for execution scheduling. Tests: executor loads plan from DB, writes session logs.

### section-08-status-polling
Live session status on timeline. setTimeout-based polling every 30s. Fetch /api/planner/today-sessions, update DOM status indicators (completed/running/failed/planned). Auto-regeneration trigger when phone added. Tests: polling updates session status correctly.
