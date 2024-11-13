// script.js
const firebaseConfig = {
    apiKey: "AIzaSyCaWZRDYEE4yu20cbqVsEgjQYD7DFINlrY",
    authDomain: "gtd-tracking.firebaseapp.com",
    databaseURL: "https://gtd-tracking-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "gtd-tracking",
    storageBucket: "gtd-tracking.appspot.com",
    messagingSenderId: "726694015626",
    appId: "1:726694015626:web:24fb6334492e8457d83373",
    measurementId: "G-99VN5DYBDH"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const database = firebase.database();

const statuses = ['In', 'Todo', 'InProgress', 'Waiting', 'Done', 'Maybe', 'Refs', 'Archive'];
let tasks = [];
let projects = [];
let quill;
let datepicker;
let currentUser = null;
let selectedColumns = new Set(statuses);
let currentProjectFilter = '';

function login() {
    const email = document.getElementById('emailInput').value;
    const password = document.getElementById('passwordInput').value;
    auth.signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
            currentUser = userCredential.user;
            document.getElementById('loginContainer').style.display = 'none';
            document.getElementById('appContainer').style.display = 'block';
            loadData();
        })
        .catch((error) => {
            alert('Login failed: ' + error.message);
        });
}

function register() {
    const email = document.getElementById('emailInput').value;
    const password = document.getElementById('passwordInput').value;
    auth.createUserWithEmailAndPassword(email, password)
        .then((userCredential) => {
            currentUser = userCredential.user;
            document.getElementById('loginContainer').style.display = 'none';
            document.getElementById('appContainer').style.display = 'block';
            initializeUserData();
        })
        .catch((error) => {
            alert('Registration failed: ' + error.message);
        });
}

function logout() {
    auth.signOut().then(() => {
        currentUser = null;
        document.getElementById('loginContainer').style.display = 'block';
        document.getElementById('appContainer').style.display = 'none';
    }).catch((error) => {
        console.error('Logout error:', error);
    });
}

function initializeUserData() {
    database.ref('users/' + currentUser.uid).set({
        tasks: [],
        projects: []
    });
}

function loadData() {
    database.ref('users/' + currentUser.uid).on('value', (snapshot) => {
        const data = snapshot.val();
        tasks = data.tasks || [];
        projects = data.projects || [];
        renderBoard();
        renderProjectList();
        populateProjectFilter();
        populateColumnSelector();
        currentProjectFilter = document.getElementById('projectFilter').value;
    });
}

function saveData() {
    database.ref('users/' + currentUser.uid).set({
        tasks: tasks,
        projects: projects
    }).then(() => {
        console.log("Data saved successfully");
    }).catch((error) => {
        console.error("Data could not be saved." + error);
    });
}

function saveTasks() {
    saveData();
}

function saveProjects() {
    const previousFilter = currentProjectFilter;
    saveData();
    populateProjectFilter();
    restoreProjectFilter(previousFilter);
}

function clearArchive() {
    if (confirm('Are you sure you want to delete all archived tasks? This action cannot be undone.')) {
        tasks = tasks.filter(task => task.status !== 'Archive');
        saveTasks();
        renderBoard();
    }
}

function hideColumn(status) {
    selectedColumns.delete(status);
    renderBoard();
}

function renderBoard() {
    checkProjectWarnings();
    
    const board = document.getElementById('board');
    board.innerHTML = '';
    
    statuses.forEach(status => {
        if (!selectedColumns.has(status)) return;
        
        const column = document.createElement('div');
        column.className = 'column';
        
        const columnHeader = document.createElement('div');
        columnHeader.className = 'column-header';
        columnHeader.innerHTML = `
            <h2>${status}</h2>
            <div class="column-controls">
                ${status === 'Archive' ? 
                    '<button class="clear-archive-btn" onclick="clearArchive()">Clear Archive</button>' : 
                    ''
                }
                <button class="hide-column-btn" onclick="hideColumn('${status}')" title="Hide Column">
                    <svg viewBox="0 0 24 24" width="14" height="14">
                        <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                </button>
            </div>
        `;
        
        column.appendChild(columnHeader);
        
        const columnContent = document.createElement('div');
        columnContent.className = 'column-content';
        column.appendChild(columnContent);
        
        column.ondragover = allowDrop;
        column.ondrop = (event) => drop(event, status);
        
        const statusTasks = tasks.filter(task => 
            task.status === status && 
            (!currentProjectFilter || task.project === currentProjectFilter || (!task.project && currentProjectFilter === ''))
        );
        
        statusTasks.forEach(task => {
            const taskCard = createTaskCard(task);
            columnContent.appendChild(taskCard);
        });
        
        board.appendChild(column);
    });
}

function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'Invalid Date';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

function createTaskCard(task) {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.draggable = true;
    card.ondragstart = drag;
    card.onclick = () => openTaskModal(task);
    card.id = task.id;
    const project = projects.find(p => p.name === task.project);
    const backgroundColor = project ? project.color : '#ffffff';
    const textColor = getContrastColor(backgroundColor);
    
    let dateHtml = '';
    if (task.date) {
        const taskDate = new Date(task.date);
        const isOverdue = taskDate < new Date() && task.status !== 'Done';
        dateHtml = `<div class="date ${isOverdue ? 'overdue' : ''}">${formatDate(taskDate)}</div>`;
    }
    
    let pomodoroHtml = '';
    if (task.pomodoro && task.pomodoro > 0) {
        pomodoroHtml = `<div class="pomodoro">Pomodoro: ${task.pomodoro}</div>`;
    }
    
    card.innerHTML = `
        <div><strong>${task.name}</strong></div>
        ${task.project ? `<div class="project" style="background-color: ${backgroundColor}; color: ${textColor};">${task.project}</div>` : ''}
        ${dateHtml}
        ${pomodoroHtml}
    `;
    return card;
}

function getContrastColor(hexcolor) {
    hexcolor = hexcolor.replace("#", "");
    var r = parseInt(hexcolor.substr(0,2),16);
    var g = parseInt(hexcolor.substr(2,2),16);
    var b = parseInt(hexcolor.substr(4,2),16);
    var yiq = ((r*299)+(g*587)+(b*114))/1000;
    return (yiq >= 128) ? 'black' : 'white';
}

function addNewTask() {
    openTaskModal();
}

function openTaskModal(task = null) {
    const modal = document.getElementById('taskModal');
    const form = document.getElementById('taskForm');
    const deleteBtn = document.querySelector('.delete-btn');
    const projectSelect = document.getElementById('taskProject');
    
    projectSelect.innerHTML = '<option value="">No Project</option>';
    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.name;
        option.textContent = project.name;
        projectSelect.appendChild(option);
    });

    if (task) {
        document.getElementById('taskId').value = task.id;
        document.getElementById('taskName').value = task.name;
        quill.root.innerHTML = task.description;
        document.getElementById('taskProject').value = task.project || '';
        document.getElementById('taskStatus').value = task.status;
        const dateObj = new Date(task.date);
        const formattedDate = `${String(dateObj.getDate()).padStart(2, '0')}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${dateObj.getFullYear()}`;
        datepicker.setDate(formattedDate, false);
        document.getElementById('taskPomodoro').value = task.pomodoro || 0;
        deleteBtn.style.display = 'inline-block';
    } else {
        form.reset();
        document.getElementById('taskId').value = '';
        quill.root.innerHTML = '';
        document.getElementById('taskProject').value = '';
        document.getElementById('taskPomodoro').value = 0;
        deleteBtn.style.display = 'none';
    }
    modal.style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

document.querySelectorAll('.close').forEach(closeBtn => {
    closeBtn.onclick = () => closeModal(closeBtn.closest('.modal').id);
});

function parseDate(dateString) {
    if (!dateString) return null;
    const [day, month, year] = dateString.split('-');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

document.getElementById('taskForm').onsubmit = function(e) {
    e.preventDefault();
    const taskId = document.getElementById('taskId').value;
    const taskDate = document.getElementById('taskDate').value;

    const task = {
        id: taskId || Date.now().toString(),
        name: document.getElementById('taskName').value,
        description: quill.root.innerHTML,
        project: document.getElementById('taskProject').value || null,
        status: document.getElementById('taskStatus').value,
        date: parseDate(taskDate),
        pomodoro: parseInt(document.getElementById('taskPomodoro').value, 10)
    };
    if (taskId) {
        const index = tasks.findIndex(t => t.id === taskId);
        tasks[index] = task;
    } else {
        tasks.push(task);
    }
    saveTasks();
    renderBoard();
    closeModal('taskModal');
};

function deleteTask() {
    const taskId = document.getElementById('taskId').value;
    if (taskId) {
        if (confirm('Are you sure you want to delete this task?')) {
            tasks = tasks.filter(t => t.id !== taskId);
            saveTasks();
            renderBoard();
            closeModal('taskModal');
        }
    }
}

function openProjectModal() {
    const modal = document.getElementById('projectModal');
    renderProjectList();
    modal.style.display = 'block';
}

document.getElementById('projectForm').onsubmit = function(e) {
    e.preventDefault();
    const projectName = document.getElementById('projectName').value;
    const projectColor = document.getElementById('projectColor').value;
    projects.push({ name: projectName, color: projectColor });
    saveProjects();
    renderProjectList();
    this.reset();
};

function renderProjectList() {
    const projectList = document.getElementById('projectList');
    projectList.innerHTML = '';
    projects.forEach(project => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>
                <span class="color-preview" style="background-color: ${project.color};"></span>
                ${project.name}
            </span>
            <button onclick="deleteProject('${project.name}')">Delete</button>
        `;
        projectList.appendChild(li);
    });
}

function deleteProject(projectName) {
    if (confirm(`Are you sure you want to delete project "${projectName}"?`)) {
        projects = projects.filter(p => p.name !== projectName);
        tasks = tasks.map(t => t.project === projectName ? {...t, project: null} : t);
        saveProjects();
        saveTasks();
        renderProjectList();
        renderBoard();
    }
}

function allowDrop(ev) {
    ev.preventDefault();
}

function drag(ev) {
    ev.dataTransfer.setData("text", ev.target.id);
}

function drop(ev, status) {
    ev.preventDefault();
    const taskId = ev.dataTransfer.getData("text");
    const task = tasks.find(t => t.id === taskId);
    if (task) {
        task.status = status;
        saveTasks();
        renderBoard();
    }
}

function incrementPomodoro() {
    const pomodoroInput = document.getElementById('taskPomodoro');
    pomodoroInput.value = parseInt(pomodoroInput.value, 10) + 1;
}

function decrementPomodoro() {
    const pomodoroInput = document.getElementById('taskPomodoro');
    const currentValue = parseInt(pomodoroInput.value, 10);
    if (currentValue > 0) {
        pomodoroInput.value = currentValue - 1;
    }
}

function populateProjectFilter() {
    const projectFilter = document.getElementById('projectFilter');
    const currentSelection = projectFilter.value;
    projectFilter.innerHTML = '<option value="">All Projects</option>';
    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.name;
        option.textContent = project.name;
        projectFilter.appendChild(option);
    });
    
    if (projects.some(p => p.name === currentSelection) || currentSelection === '') {
        projectFilter.value = currentSelection;
    } else {
        projectFilter.value = '';
    }
    
    currentProjectFilter = projectFilter.value;
}

function restoreProjectFilter(previousFilter) {
    const projectFilter = document.getElementById('projectFilter');
    if (projects.some(p => p.name === previousFilter) || previousFilter === '') {
        projectFilter.value = previousFilter;
    } else {
        projectFilter.value = '';
    }
    currentProjectFilter = projectFilter.value;
    renderBoard();
}

function applyFilter() {
    const projectFilter = document.getElementById('projectFilter');
    currentProjectFilter = projectFilter.value;
    renderBoard();
}

function populateColumnSelector() {
    const columnSelector = document.getElementById('columnSelector');
    columnSelector.innerHTML = '';
    statuses.forEach(status => {

        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = status;
        checkbox.checked = selectedColumns.has(status);
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedColumns.add(status);
            } else {
                selectedColumns.delete(status);
            }
            renderBoard();
        });
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(status));
        columnSelector.appendChild(label);
    });
}

function applyView() {
    const viewSelector = document.getElementById('viewSelector');
    const columnSelector = document.getElementById('columnSelector');
    if (viewSelector.value === 'all') {
        selectedColumns = new Set(statuses);
        columnSelector.style.display = 'none';
    } else {
        columnSelector.style.display = 'flex';
    }
    renderBoard();
}

function checkProjectWarnings() {
    const warningsContainer = document.getElementById('projectWarnings');
    warningsContainer.innerHTML = '';

    const activeStatuses = ['Todo', 'InProgress'];
    
    projects.forEach(project => {
        const hasActiveTasks = tasks.some(task => 
            task.project === project.name && activeStatuses.includes(task.status)
        );

        if (!hasActiveTasks) {
            const warningDiv = document.createElement('div');
            warningDiv.className = 'project-warning';
            warningDiv.textContent = `No active tasks for project: ${project.name}`;
            warningsContainer.appendChild(warningDiv);
        }
    });
}

document.addEventListener('DOMContentLoaded', function() {
    quill = new Quill('#editor-container', {
        theme: 'snow',
        modules: {
            toolbar: [
                ['bold', 'italic', 'underline'],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                ['clean']
            ]
        }
    });

    datepicker = flatpickr("#taskDate", {
        dateFormat: "d-m-Y",
        altInput: true,
        altFormat: "d-m-Y",
        allowInput: true,
        locale: {
            firstDayOfWeek: 1
        }
    });

    auth.onAuthStateChanged((user) => {
        if (user) {
            currentUser = user;
            document.getElementById('loginContainer').style.display = 'none';
            document.getElementById('appContainer').style.display = 'block';
            loadData();
        } else {
            document.getElementById('loginContainer').style.display = 'block';
            document.getElementById('appContainer').style.display = 'none';
        }
    });

    document.getElementById('viewSelector').addEventListener('change', applyView);
});