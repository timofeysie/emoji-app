output "vpc_id" {
  description = "Default VPC used by staging."
  value       = module.network.vpc_id
}

output "subnet_ids" {
  description = "Subnet IDs in the default VPC."
  value       = module.network.subnet_ids
}

output "alb_security_group_id" {
  description = "Security group attached to the ALB."
  value       = module.network.alb_security_group_id
}

output "ecs_security_group_id" {
  description = "Security group attached to the ECS tasks."
  value       = module.network.ecs_security_group_id
}

output "alb_arn" {
  description = "ARN of the application load balancer."
  value       = module.alb.alb_arn
}

output "alb_dns_name" {
  description = "Public DNS name of the ALB (use this to hit the staging app over HTTP)."
  value       = module.alb.alb_dns_name
}

output "target_group_arn" {
  description = "ARN of the ECS target group attached to the ALB."
  value       = module.alb.target_group_arn
}

output "http_listener_arn" {
  description = "ARN of the HTTP:80 listener."
  value       = module.alb.http_listener_arn
}

output "ecs_execution_role_arn" {
  description = "ARN of the ECS task execution role."
  value       = module.iam_ecs.execution_role_arn
}

output "ecs_task_role_arn" {
  description = "ARN of the ECS task role."
  value       = module.iam_ecs.task_role_arn
}

# Additional outputs are added as later modules come online:
#   - ecs_cluster_name
#   - ecs_service_name
#   - task_definition_arn
