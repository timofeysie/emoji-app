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

# Additional outputs are added as later modules come online:
#   - alb_dns_name
#   - target_group_arn
#   - ecs_cluster_name
#   - ecs_service_name
#   - task_definition_arn
