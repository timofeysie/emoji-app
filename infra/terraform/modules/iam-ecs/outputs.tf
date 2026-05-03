output "execution_role_arn" {
  description = "ARN of the ECS task execution role (ECR pull, CloudWatch logs)."
  value       = aws_iam_role.ecs_execution.arn
}

output "execution_role_name" {
  description = "Name of the ECS task execution role."
  value       = aws_iam_role.ecs_execution.name
}

output "task_role_arn" {
  description = "ARN of the ECS task role (Secrets Manager access)."
  value       = aws_iam_role.ecs_task.arn
}

output "task_role_name" {
  description = "Name of the ECS task role."
  value       = aws_iam_role.ecs_task.name
}
