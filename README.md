# Kh_APS_2025 (APS BIM Viewer & Dashboard)

Autodesk Platform Services (구 Forge)를 기반으로 구축된 BIM 모델 뷰어 및 데이터 분석 대시보드 프로젝트입니다.
웹 브라우저 상에서 Revit 모델을 시각화하고, 객체 속성(예: 벽체 데이터)을 추출하여 분석하거나 AI 어시스턴트와 연동하는 기능을 포함하고 있습니다.

## 🚀 Key Features (주요 기능)

* **BIM Model Viewer:** Autodesk Viewer API를 활용한 대용량 3D 모델 웹 시각화
* **Data Extraction:** 모델 내 특정 카테고리(Walls 등) 및 파라미터 데이터 추출
* **Hubs & Projects Connection:** ACC(Autodesk Construction Cloud) 및 BIM 360 계정 데이터 연동
* **AI Integration:** (향후 확장 예정) 모델 데이터 기반 AI 질의응답 및 자동화 지원

## 🛠 Tech Stack (기술 스택)

* **Backend:** Node.js, Express.js
* **Frontend:** HTML5, CSS3, JavaScript (Bootstrap/Vanilla JS)
* **Autodesk APIs:**
    * Authentication (OAuth 2.0)
    * Data Management API
    * Model Derivative API
    * Viewer SDK

## 💻 Getting Started (실행 방법)

이 프로젝트를 로컬 환경에서 실행하려면 Node.js가 설치되어 있어야 하며, APS 개발자 포털의 API Key가 필요합니다.

### 1. Prerequisites (준비물)
* [Node.js](https://nodejs.org/) (LTS 버전 권장)
* [APS Developer Credentials](https://aps.autodesk.com/) (Client ID & Client Secret)

### 2. Installation (설치)

```bash
# 저장소 복제
git clone [https://github.com/iredrion-img/Kh_APS_2025.git](https://github.com/iredrion-img/Kh_APS_2025.git)

# 프로젝트 폴더로 이동
cd Kh_APS_2025

# 의존성 라이브러리 설치
npm install
