locals {
  # Container env vars are assembled here so the resource block stays readable
  # and consumers only have to pass the values they care about.
  base_environment = [
    { name = "NODE_ENV", value = var.node_env },
    { name = "HOST", value = "0.0.0.0" },
    { name = "PORT", value = tostring(var.container_port) },
    { name = "DISABLE_AUTH", value = var.disable_auth },
    { name = "COGNITO_REGION", value = var.cognito_region },
    { name = "COGNITO_USER_POOL_ID", value = var.cognito_user_pool_id },
    { name = "COGNITO_APP_CLIENT_ID", value = var.cognito_app_client_id },
  ]

  # Both staging secrets are stored as JSON key/value pairs of the form
  # {"<env-var-name>":"<value>"}. The :KEY:: suffix on valueFrom tells ECS
  # to inject just that JSON field, not the whole blob. Note that revision
  # 1 (manually registered) used the bare ARN and would have injected the
  # full JSON object - that revision was never actually run because no ECS
  # service exists yet (T6). The Terraform-managed revision corrects this.
  mongodb_secret = {
    name      = "MONGODB_URI"
    valueFrom = "${var.mongodb_uri_secret_arn}:MONGODB_URI::"
  }

  openai_secret = var.openai_api_key_secret_arn == null ? null : {
    name      = "OPENAI_API_KEY"
    valueFrom = "${var.openai_api_key_secret_arn}:OPENAI_API_KEY::"
  }

  container_secrets = local.openai_secret == null ? [local.mongodb_secret] : [
    local.mongodb_secret,
    local.openai_secret,
  ]

  container_definitions = [
    {
      name      = var.container_name
      image     = var.image_uri
      essential = true
      cpu       = 0

      portMappings = [
        {
          name          = "${var.container_name}-${var.container_port}-tcp"
          containerPort = var.container_port
          hostPort      = var.container_port
          protocol      = "tcp"
          appProtocol   = "http"
        }
      ]

      environment = local.base_environment
      secrets     = local.container_secrets

      logConfiguration = {
        logDriver = "awslogs"
        # The "awslogs-create-group" option is intentionally omitted: ECS
        # only accepts that option when set to "true", and rejects "false"
        # outright. Since aws_cloudwatch_log_group.app already exists when
        # this revision is registered, the agent has nothing to create.
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ]
}

resource "aws_ecs_task_definition" "this" {
  family                   = var.family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory

  execution_role_arn = var.execution_role_arn
  task_role_arn      = var.task_role_arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode(local.container_definitions)
}
