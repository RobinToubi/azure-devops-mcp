## ADDED Requirements

### Requirement: Multi-stage Docker Build

The system SHALL provide a multi-stage Dockerfile that separates the build environment from the runtime environment to minimize the final image size.

#### Scenario: Build and Run

- **WHEN** the Docker image is built using `docker build`
- **THEN** the resulting image contains only the necessary runtime artifacts (dist, node_modules, package.json) and excludes source code and build tools.

### Requirement: Hadolint Compliance

The Dockerfile SHALL comply with `hadolint` best practices for Dockerfiles.

#### Scenario: Linting the Dockerfile

- **WHEN** `hadolint Dockerfile` is executed
- **THEN** no errors or warnings are reported.

### Requirement: Non-root User Execution

The Docker container SHALL run the application as a non-root user to enhance security.

#### Scenario: Container Process User

- **WHEN** the container is started
- **THEN** the application process runs as a non-privileged user (e.g., `node`).

### Requirement: Node.js 20+ Runtime

The Docker image SHALL use an official Node.js 20 or higher base image.

#### Scenario: Node Version Check

- **WHEN** `node --version` is run inside the container
- **THEN** the output indicates a version major of 20 or greater.

### Requirement: Build Context Optimization

The project SHALL include a `.dockerignore` file to prevent unnecessary files from being sent to the Docker daemon.

#### Scenario: Build Context Size

- **WHEN** the Docker build is initiated
- **THEN** folders like `.git`, `node_modules` (local), and `test` are excluded from the build context.
