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
  description = "Container port exposed for the ALB target group registration in T6."
  value       = var.container_port
}
