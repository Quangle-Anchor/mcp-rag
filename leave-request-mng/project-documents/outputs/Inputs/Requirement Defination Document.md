# REQUIREMENT DEFINITION DOCUMENT (RDD)

**System Name:** Mendix Leave Management System
**Document Version:** 1.0.0
**Date:** May 13, 2026

### Document Control

| Role | Name | Department / Title |
| --- | --- | --- |
| **Author** | Nam Vu Le | Solution Architect |
| **Reviewers** | Akai, Nakatsuka | Project Management / Stakeholders |
| **Tech Team** | Quan, Long, Tung | Development / Engineering |

---

## 1. System Overview

### 1.1. Background and Purpose

The current leave management process relies on manual tracking, leading to delays in approvals and inconsistencies in leave balance calculations. The purpose of this system is to digitalize and automate the leave request and approval workflow using the Mendix Low-Code Platform, ensuring real-time data accuracy, centralized management via Mendix's internal database, and improved operational efficiency.

### 1.2. System Scope

The system covers the end-to-end process of leave management, including:

* Checking available leave balances.
* Submission of leave requests (Full day, Half-day).
* Approval/Rejection workflow by direct managers.
* Automated calculation and deduction of leave balances.
* Role-based access control and dashboards.

---

## 2. Business Requirements

### 2.1. Target User Roles

| Role | Description |
| --- | --- |
| **Employee** | Standard user. Can submit leave requests, view their own history, and check their current leave balances. |
| **Manager** | Supervisory user. Receives notifications for team members' requests. Can approve or reject requests and provide comments. |
| **HR / Admin** | System administrator. Manages system configurations, defines leave types, and has full read/write access to all user balances for auditing. |

### 2.2. To-Be Business Process Flow

1. **Application:** Employee logs into the Mendix application, checks their `LeaveBalance`, and submits a `LeaveRequest`.
2. **Validation:** The system automatically checks business rules (e.g., sufficient balance, valid date ranges).
3. **Notification:** The Manager receives an automated email notification regarding the pending request.
4. **Decision:** The Manager reviews the request on their dashboard and selects "Approve" or "Reject".
5. **Execution:** The system automatically updates the `LeaveRequest` status and recalculates the `LeaveBalance` in the internal database. The Employee is notified of the final decision.

---

## 3. Functional Requirements

### 3.1. Core Use Cases

* **UC-01: View Leave Dashboard**
* The system must display the Employee's allocated, used, pending, and available days categorized by `LeaveType`.


* **UC-02: Submit Leave Request**
* The system must allow Employees to input `StartDate`, `EndDate`, `LeaveType`, `Reason`, and an `IsHalfDay` flag (with morning/afternoon selection).
* The system must validate input via a Microflow before committing to the database.


* **UC-03: Process Leave Request**
* The system must provide Managers with a data grid of `Pending` requests.
* The system must require a `ManagerComment` if a request is rejected.


* **UC-04: Automated Balance Calculation**
* The system must automatically deduct approved days from `AvailableDays` and move them to `UsedDays`.
* The system must exclude weekends and public holidays during the calculation (via a dedicated Mendix sub-microflow).



### 3.2. Data Requirements (Domain Model)

The system will utilize the Mendix Internal Database. The core entities include:

* **Employee:** Extended from `Administration.Account`.
* **LeaveType:** Master data for leave categories (Annual, Sick, Unpaid).
* **LeaveBalance:** Stores the numerical allocation and usage per Employee per Leave Type.
* **LeaveRequest:** Transactional data capturing the details, status (`Draft`, `Pending`, `Approved`, `Rejected`), and workflow history of a request.

### 3.3. Screen & UI Requirements

The user interface will be built using the Mendix **Atlas UI** framework to ensure a responsive design across desktop and mobile devices.

* **Employee Dashboard (`Leave_Overview_Employee`):** Split layout featuring a Data View for balances and a List View for request history.
* **Request Form (`Leave_NewEdit`):** Dynamic form using Conditional Visibility (e.g., hiding half-day session dropdowns if `IsHalfDay` is false).
* **Manager Dashboard (`Manager_Approval_Dashboard`):** Action-oriented Data Grid filtered by `Status = Pending` and `Approver = [%CurrentUser%]`.

---

## 4. Non-Functional Requirements

*Based on the IPA Non-Functional Requirements Grade*

### 4.1. Availability & Reliability

* **Operating Hours:** 24/7/365, with standard Mendix Cloud SLA (99.5% uptime).
* **RPO / RTO:** Dependent on Mendix standard automated database backup schedules (daily backups with transaction logs).

### 4.2. Performance & Scalability 

* **Response Time:** Online transaction processing (e.g., submitting a request, loading the dashboard) must complete within 3 seconds under normal load.
* **Concurrency:** The system must support simultaneous access by up to 500 internal employees without performance degradation.

### 4.3. Security & Access Control

* **Authentication:** Standard Mendix local account authentication.
* **Authorization:** Enforced via Mendix Module Security.
* *XPath Constraints* must be strictly applied. For example, Employees can only read `LeaveBalance` where `[LeaveManagement.LeaveBalance_Employee/LeaveManagement.Employee/System.User_Account = '[%CurrentUser%]']`.


* **Audit Trail:** The system must log the `createdDate`, `changedDate`, and the user who executed the changes for all `LeaveRequest` state transitions.

### 4.4. Environment & Maintainability

* **Architecture:** Fully encapsulated Mendix module without external database dependencies. All business logic is handled via Microflows/Nanoflows.
* **Modifiability:** Leave policy rules (e.g., default days per year) must be configurable by HR via master data screens without requiring developer intervention or application redeployment.

---

## 5. Constraints and Assumptions

* **Platform Constraint:** The solution must be built entirely within the Mendix Studio Pro IDE.
* **Email Gateway:** The Mendix Email Module with SMTP configuration will be utilized for all workflow notifications.
* **Data Migration:** Historical leave data from legacy systems will be imported via Excel utilizing the Mendix Excel Importer module prior to go-live.