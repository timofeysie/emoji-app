# Glossary

This doc explains terms we use in engineering milestones so non-specialists can follow
the roadmap. It is not a legal document; it is a communication aid.

## Table of contents

- [API (Application Programming Interface)](#api-application-programming-interface)
- [Container](#container)
- [Container image](#container-image)
- [Docker (often used when people say “Docker image”)](#docker-often-used-when-people-say-docker-image)
- [Workload (compute workload)](#workload-compute-workload)
- [Amazon ECS (Elastic Container Service)](#amazon-ecs-elastic-container-service)
- [Fargate](#fargate)
- [Task (ECS task)](#task-ecs-task)
- [Service (ECS service)](#service-ecs-service)
- [EC2 (Elastic Compute Cloud)](#ec2-elastic-compute-cloud)
- [Load balancer (ALB: Application Load Balancer)](#load-balancer-alb-application-load-balancer)
- [Target group (load balancer)](#target-group-load-balancer)
- [Staging and production (environments)](#staging-and-production-environments)
- [CI/CD (Continuous Integration and Continuous Delivery/Deployment)](#cicd-continuous-integration-and-continuous-deliverydeployment)
- [Secret (secret value)](#secret-secret-value)
- [Amazon Secrets Manager (often called “Secrets Manager”)](#amazon-secrets-manager-often-called-secrets-manager)
- [MongoDB](#mongodb)
- [Mongoose](#mongoose)
- [ODM (Object Document Mapper)](#odm-object-document-mapper)
- [MongoDB Atlas](#mongodb-atlas)
- [Connection string (Mongo URI)](#connection-string-mongo-uri)
- [SRV URI (`mongodb+srv://`)](#srv-uri-mongodbsrv)
- [Non-SRV URI (`mongodb://`)](#non-srv-uri-mongodb)
- [DNS SRV lookup](#dns-srv-lookup)
- [Replica set](#replica-set)
- [Primary and secondary nodes](#primary-and-secondary-nodes)
- [MongoDB transaction](#mongodb-transaction)
- [WebSocket (real-time connection)](#websocket-real-time-connection)
- [API Gateway (Amazon API Gateway) — optional “edge” layer](#api-gateway-amazon-api-gateway--optional-edge-layer)
- [Alert rule](#alert-rule)
- [On-call owner](#on-call-owner)
- [Point-in-time recovery (PITR)](#point-in-time-recovery-pitr)
- [Scalability (scale)](#scalability-scale)
- [Observability (logs, metrics, tracing)](#observability-logs-metrics-tracing)
- [Incident response (ops)](#incident-response-ops)
- [Idempotency (common distributed systems term)](#idempotency-common-distributed-systems-term)

## API (Application Programming Interface)

A structured way for one program to ask another program for work. In this project, the
browser talks to our server through HTTP endpoints like `/api/games`.

## Container

A **package** that ships an app together with everything it needs to run the same way on
different machines. Think: “a lunchbox that always contains the same meal,” so the
kitchen can be different, but the meal is consistent.

Containers are often built from a **container image**.

## Container image

A saved, versioned snapshot used to create containers. Think: a **recipe + ingredients
pre-measured** so every cook produces the same dish.

In practice, the image is what we build in CI and deploy to AWS.

## Docker (often used when people say “Docker image”)

A popular toolchain for building and running containers. “Dockerize” colloquially means
“put the app in a container so it is portable and repeatable.”

## Workload (compute workload)

A fancy word for “the app service(s) that need to run and scale.”

Examples: “the API service,” “the background job worker,” “the real-time service.”

## Amazon ECS (Elastic Container Service)

An AWS service that **runs and manages containerized applications**. Think of it as the
**orchestrator** that starts/stops app instances, places them in the network, and keeps
the desired number running.

## Fargate

An AWS “serverless” way to run containers where **AWS manages the machines** (servers) underneath. We choose CPU/memory, AWS runs the physical hosts.

Mental model: we rent **just the right-sized table at a restaurant**, not the building.

## Task (ECS task)

A running instance of a container (or a small set of related containers) as defined by the ECS task definition. Think: one “serving” of the app.

## Service (ECS service)

A long-lived ECS configuration that **keeps tasks running** at the desired count and can roll out new versions. Think: “keep at least 2 waiters on shift.”

## EC2 (Elastic Compute Cloud)

Virtual machines in AWS you manage more directly. **Fargate is an alternative to running
EC2 yourself** for container hosting.

Mental model: rent a **raw computer**; you install more of the stack yourself.

## Load balancer (ALB: Application Load Balancer)

A front door that receives internet traffic and **routes** it to healthy app instances.
It can also help with HTTPS termination and, for this app, **WebSocket** connections
through a supported load-balancing path.

Mental model: a **receptionist** for a busy office, directing visitors to the right room.

## Target group (load balancer)

The group of backend destinations (for example, ECS tasks) the load balancer sends traffic
to, usually selected by health checks.

## Staging and production (environments)

- **Staging**: a safe, production-like place to test changes before customers see them.
- **Production**: the live system customers use.

## CI/CD (Continuous Integration and Continuous Delivery/Deployment)

Automation that builds, tests, and ships app changes in a controlled way. Think: an
**assembly line** for software releases.

## Secret (secret value)

A sensitive configuration value, such as a database password, stored outside source code
and handed to the app at runtime. AWS often stores these in **Secrets Manager** or
**SSM Parameter Store**.

## Amazon Secrets Manager (often called “Secrets Manager”)

A managed place to store secrets, sometimes with **rotation** policies and tight access
controls. Think: a **team safe** with an audit log of who can open it.

## MongoDB

A document-oriented database. We store many game objects as **documents** in
**collections**.

## Mongoose

A Node.js library (ODM) that helps define **schemas**, validate data, and talk to MongoDB
with TypeScript-friendly models in our server code.

## ODM (Object Document Mapper)

A mapping layer between application objects and database documents, similar in spirit to
an ORM for SQL databases, but for document databases.

## MongoDB Atlas

MongoDB’s managed database service. “Managed” here means: backups, updates, monitoring
baselines, and operational guardrails are largely handled by the vendor.

## Connection string (Mongo URI)

A single string that tells the app how to connect to a database, including where it lives
and authentication parameters. In our app this is often provided as `MONGODB_URI`.

## SRV URI (`mongodb+srv://`)

A short MongoDB URI format that relies on DNS to discover cluster hosts and settings.
It is convenient, but depends on your network being able to resolve SRV DNS records.

## Non-SRV URI (`mongodb://`)

A MongoDB URI format that explicitly lists cluster hosts. It is sometimes more reliable
on restricted networks because it does not depend on SRV discovery.

## DNS SRV lookup

A DNS query type used by `mongodb+srv://` connection strings. If your network blocks
or misroutes these lookups, app startup can fail with errors like `querySrv ECONNREFUSED`.

## Replica set

A MongoDB deployment pattern with redundancy and (critically) features like replication.
Many production Mongo topologies (including Atlas clusters) are built around replica set
concepts. This matters for features like **multi-document transactions** in some setups.

(You do not need to understand the internals, only that “production shape” and “toy local
setup” are not always equivalent.)

## Primary and secondary nodes

In a replica set, the **primary** accepts writes and **secondary** nodes replicate data
from it. If the primary fails, another node can be elected to continue service.

## MongoDB transaction

A way to group multiple database writes so they either all succeed or all fail together.
This protects consistency in game flows that update multiple records.

## WebSocket (real-time connection)

A long-lived network connection that allows the server to **push** updates to a browser
without the browser constantly re-asking. Useful for live dashboards and live game
events.

Mental model: a **phone call** (ongoing) instead of a **letter** (one request, one
response each time).

## API Gateway (Amazon API Gateway) — optional “edge” layer

A managed way to build API front doors in AWS, sometimes used for advanced routing, auth
integration, throttling, and WebSocket topologies. It is not required to run a solid app on
**ECS + ALB**; it is an **optional** architecture layer depending on product needs.

## Alert rule

A monitoring rule that triggers notifications when a condition is met, such as high
connections or a host being down.

## On-call owner

The person or team responsible for acknowledging and responding to alerts.

## Point-in-time recovery (PITR)

A backup capability that allows restoring a database to a specific past time. Useful for
operational recovery, but often deferred in early prototype stages.

## Scalability (scale)

The ability to handle more users, more games, or more traffic by adding resources or
instances without rewriting the app from scratch.

## Observability (logs, metrics, tracing)

Ways to understand what a running system is doing when users report problems:
**logs** (what happened), **metrics** (how busy/slow/healthy), and **tracing** (follow a
request through components).

Mental model: a **flight data recorder** for software.

## Incident response (ops)

A disciplined way to respond when something breaks: detect, mitigate, restore service,
post-incident learnings.

## Idempotency (common distributed systems term)

Designing an operation so repeating it (for example, double-click, duplicate scan) does
not cause duplicate harmful effects. Important for real hardware inputs like NFC.
