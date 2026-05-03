variable "environment" {
  description = "Logical environment name used in resource tags."
  type        = string
}

variable "vpc_id" {
  description = "VPC the target group registers against (must be the same VPC the ECS service runs in)."
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs the ALB is attached to. Provide only the subnets you intend the ALB to use, not all available subnets."
  type        = list(string)
}

variable "alb_security_group_id" {
  description = "Security group ID attached to the ALB."
  type        = string
}
