data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    sid     = ""
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "emoji-staging-ecs-execution-role"
  description        = "Allows ECS tasks to call AWS services on your behalf."
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "exec_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name               = "emoji-staging-ecs-task-role"
  description        = "Allows ECS tasks to call AWS services on your behalf."
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# Tracked follow-up (least-privilege cleanup): this AWS-managed policy was
# auto-attached by the IAM console wizard when picking the "ECS tasks" trust
# template. It grants broad EC2/ELB actions that a Fargate task role does not
# need. We import it here to keep the T4 plan additive-only, and remove it in
# a follow-up commit once the rest of the stack is under Terraform.
resource "aws_iam_role_policy_attachment" "task_legacy_ecs_role" {
  role       = aws_iam_role.ecs_task.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceRole"
}

locals {
  secret_arn_patterns = [
    for name in var.managed_secret_names :
    "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:emoji-app/${var.environment}/${name}*"
  ]
}

data "aws_iam_policy_document" "read_secrets" {
  statement {
    sid    = "ReadStagingSecrets"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = local.secret_arn_patterns
  }
}

resource "aws_iam_role_policy" "read_secrets" {
  name   = "emoji-staging-read-secrets"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.read_secrets.json
}
