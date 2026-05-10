# Source Materials — Jordan Rivera

## Contact
- Email: jordan.rivera@example.com
- Phone: +1 (555) 010-2024
- Location: Brooklyn, NY
- LinkedIn: linkedin.com/in/jordan-rivera-eng
- GitHub: github.com/jrivera-eng

## Summary
Senior software engineer with 7 years building distributed systems and developer tooling.
Strong record of shipping production infrastructure that improves throughput, reliability,
and team velocity.

## Experience

### Acme Cloud Inc — Senior Software Engineer
**Brooklyn, NY · Mar 2022 – Present**

- Designed and shipped a multi-region message broker handling 1.2M req/sec at p99 of 18ms,
  reducing cross-region failover time from 90s to 6s.
- Cut onboarding time for new services from 4 days to 6 hours by building a self-serve CI/CD
  template now used by 38 services across 11 teams.
- Mentored 4 mid-level engineers; promoted 2 to senior.
- Led the migration of the customer-facing API from REST to gRPC, reducing average payload
  size by 62% and tail latency by 41%.

### Brightline Analytics — Software Engineer
**New York, NY · Jul 2019 – Feb 2022**

- Built the streaming ETL platform that ingests 4TB/day of clickstream data into Snowflake,
  enabling near-real-time dashboards used by 200+ internal analysts.
- Owned the production observability stack (Prometheus, Grafana, OpenTelemetry); reduced
  mean time to detection by 73% in 6 months.
- Wrote and open-sourced `bright-rate`, a Go-based token-bucket rate limiter (1.4k stars).
- Reduced AWS spend by $380k/yr through right-sizing and reserved-instance planning.

### Helix Labs — Software Engineer (Internship)
**Cambridge, MA · Jun 2018 – Aug 2018**

- Prototyped a Spark job for protein-protein interaction screening, processed 8,500 variants
  in 3 hours (down from 16+ hours on the legacy pipeline).
- Co-authored a paper presented at NeurIPS Workshop on ML for Health.

## Projects

### `bright-rate` (Open Source)
Go library for distributed rate limiting using Redis as a coordinator. 1.4k GitHub stars,
adopted by 7 companies (per their GitHub Discussions). Maintained for 3 years.

### `gridlines` (Personal)
Static-site generator for engineering-blog content with built-in OpenGraph + JSON-LD support.
Used to power my personal blog (~50k unique visitors/year).

### Volunteer: Codebridge NYC
Built and maintained a tutoring-match webapp serving 320 students/week. Flask + Postgres on Heroku.

## Skills

**Languages:** Go, Python, TypeScript, Rust, SQL
**Distributed systems:** gRPC, Kafka, NATS, Raft, Paxos basics, distributed tracing
**Cloud:** AWS (EC2, EKS, S3, RDS, IAM, Lambda), GCP (GKE), Cloudflare
**Data:** Snowflake, BigQuery, Postgres, Redis, Elasticsearch, dbt
**Observability:** Prometheus, Grafana, OpenTelemetry, Datadog, Honeycomb
**Tools:** Terraform, Pulumi, GitHub Actions, ArgoCD, Helm

## Education

**B.S. Computer Science** — Carnegie Mellon University (2019)
GPA: 3.84/4.00 · Dean's List 6 of 8 semesters

## Awards & Other

- 2024 Acme Cloud "Engineering Excellence" award (top 5% of engineers)
- 2023 GoCon NYC speaker — "Operating gRPC at p99"
- 2018 NSF REU Fellowship
