output "task_definition_arn" {
  description = "ARN of the latest task definition revision Terraform manages (changes every apply that mutates the spec)."
  value       = aws_ecs_task_definition.this.arn
}

output "task_definition_family" {
  description = "Task definition family name."
  value       = aws_ecs_task_definition.this.family
}

output "task_definition_revision" {
  description = "Numeric revision Terraform last registered."
  value       = aws_ecs_task_definition.this.revision
}

output "container_name" {
  description = "Name of the application container, used by the ECS service load_balancer block in T6."
  value       = var.container_name
}

output "container_port" {
  description = "Container port exposed for the ALB target group registration."
  value       = var.container_port
}

output "cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  description = "ECS cluster ARN."
  value       = aws_ecs_cluster.this.arn
}

output "service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.app.name
}

output "service_arn" {
  description = "ECS service ARN."
  value       = aws_ecs_service.app.id
}

output "log_group_name" {
  description = "Application log group name (matches what the task definition writes to)."
  value       = aws_cloudwatch_log_group.app.name
}

output "log_group_arn" {
  description = "Application log group ARN."
  value       = aws_cloudwatch_log_group.app.arn
}
